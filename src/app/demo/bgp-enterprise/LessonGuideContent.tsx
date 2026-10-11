import { ChecklistCard, CompareCards, Glossary, DArrow, DIAGRAM as D, DLink, DNode, DPill, DRegion, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { CliPanel, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { bgApply, bgClone, bgTicket, bgTicketState, createBgNet, type BgNet, type BgRouter } from "@/lib/sim-engine/scenarios/bgpNet";
import { bgRouterSets, type BgCliApi } from "./bgp-lab/bgCli";

export const BGP_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "bl-mission", label: "What this lesson teaches" },
  { id: "bl-network", label: "The network of this lesson" },
  { id: "bl-ideas", label: "Three ideas you need" },
  { id: "bl-walk", label: "What you will watch" },
  { id: "bl-problem", label: "No shared map between networks" },
  { id: "bl-session", label: "A session over TCP 179" },
  { id: "bl-routes", label: "Routes arrive with their history" },
  { id: "bl-ibgp", label: "Sharing routes inside AS65001" },
  { id: "bl-best", label: "One best path per prefix" },
  { id: "bl-policy", label: "Policy: the way out and the way back" },
  { id: "bl-verify", label: "What healthy BGP looks like" },
  { id: "bl-incident", label: "The incident" },
  { id: "bl-investigate", label: "Walk the chain" },
  { id: "bl-repair", label: "Repair and prove it" },
  { id: "bl-other", label: "Other ways BGP breaks" },
  { id: "bl-model", label: "Mental model" },
  { id: "bl-glossary", label: "Glossary" },
  { id: "bl-recap", label: "Recap" },
  { id: "bl-practice", label: "Practice it" },
];

export function Topology({ nhFault }: { nhFault?: boolean }) {
  return (
    <DiagramSvg h={290} label="AS65001 with R1 and R2; R1 peers eBGP with R3 in AS65010, R2 peers eBGP with R4 in AS65020; destination 203.0.113.0/24 in AS65030">
      <DRegion x={210} y={10} w={220} h={56} label="AS65030 · 203.0.113.0/24" color={D.success} />
      <DRegion x={20} y={84} w={240} h={70} label="AS65010 · ISP-A" color={D.bgp} />
      <DRegion x={380} y={84} w={240} h={70} label="AS65020 · ISP-B (via AS65100)" color={D.violet} />
      <DRegion x={60} y={184} w={520} h={96} label="" color={D.ospf} />
      <text x={320} y={276} textAnchor="middle" fill={D.ospf} fontSize={10} fontWeight={700}>
        AS65001 · enterprise
      </text>
      <DNode x={140} y={124} label="R3" sub="3.3.3.3" accent={D.bgp} />
      <DNode x={500} y={124} label="R4" sub="4.4.4.4" accent={D.violet} />
      <DNode x={140} y={240} label="R1" sub="1.1.1.1" />
      <DNode x={500} y={240} label="R2" sub="2.2.2.2" />
      <DLink x1={140} y1={146} x2={140} y2={218} color={D.bgp} />
      <text x={150} y={170} fill={D.bgp} fontSize={10} fontWeight={700}>
        eBGP 192.0.2.0/30
      </text>
      <DLink x1={500} y1={146} x2={500} y2={218} color={D.violet} />
      <text x={490} y={170} textAnchor="end" fill={D.violet} fontSize={10} fontWeight={700}>
        eBGP 198.51.100.0/30
      </text>
      <DLink x1={190} y1={240} x2={450} y2={240} color={nhFault ? D.danger : D.ospf} label="iBGP 10.0.12.0/30" />
      <DLink x1={180} y1={104} x2={250} y2={50} color={D.line} dashed />
      <DLink x1={460} y1={104} x2={390} y2={50} color={D.line} dashed />
    </DiagramSvg>
  );
}

export function SessionFlow() {
  return (
    <DiagramSvg h={270} label="TCP three-way handshake on port 179, then OPEN in both directions, then KEEPALIVE">
      <text x={110} y={20} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={600}>
        R1 · AS65001
      </text>
      <text x={530} y={20} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={600}>
        R3 · AS65010
      </text>
      <line x1={110} y1={30} x2={110} y2={262} stroke={D.line} strokeDasharray="3 4" />
      <line x1={530} y1={30} x2={530} y2={262} stroke={D.line} strokeDasharray="3 4" />
      <DArrow x1={112} y1={42} x2={526} y2={58} color={D.tcp} label="TCP SYN → :179" labelDy={-7} />
      <DArrow x1={528} y1={74} x2={114} y2={90} color={D.tcp} label="SYN-ACK" labelDy={-7} />
      <DArrow x1={112} y1={106} x2={526} y2={122} color={D.tcp} label="ACK · TCP up · BGP Idle → Connect" labelDy={-7} />
      <DArrow x1={112} y1={146} x2={526} y2={162} color={D.bgp} label="OPEN (AS 65001, Hold Time, BGP ID 1.1.1.1)" labelDy={-7} />
      <DArrow x1={528} y1={180} x2={114} y2={196} color={D.bgp} label="OPEN (AS 65010, BGP ID 3.3.3.3) → OpenConfirm" labelDy={-7} />
      <DArrow x1={112} y1={220} x2={526} y2={234} color={D.success} both label="KEEPALIVE ↔ KEEPALIVE" labelDy={-7} />
      <DPill x={320} y={256} text="ESTABLISHED" color={D.success} w={110} />
    </DiagramSvg>
  );
}

export function PathsDiagram() {
  return (
    <DiagramSvg h={170} label="Two candidate paths to 203.0.113.0/24 with different AS_PATH lengths">
      <DNode x={100} y={50} label="via ISP-A" sub="from R3" accent={D.bgp} w={130} />
      <DNode x={100} y={120} label="via ISP-B" sub="from R4" accent={D.violet} w={130} />
      {["65010", "65030"].map((a, i) => (
        <DPill key={a} x={230 + i * 80} y={50} text={a} color={D.bgp} w={66} />
      ))}
      {["65020", "65100", "65030"].map((a, i) => (
        <DPill key={a} x={230 + i * 80} y={120} text={a} color={D.violet} w={66} />
      ))}
      <text x={560} y={54} fill={D.success} fontSize={11} fontWeight={700}>
        2 ASes
      </text>
      <text x={560} y={124} fill={D.warning} fontSize={11} fontWeight={700}>
        3 ASes
      </text>
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={10}>
        both LOCAL_PREF 100 · ORIGIN IGP · MED 50 (ISP-A) vs 20 (ISP-B)
      </text>
    </DiagramSvg>
  );
}

export function DecisionLadder() {
  const steps: [string, string][] = [
    ["1 · Highest LOCAL_PREF", "tie at 100"],
    ["2 · Shortest AS_PATH", "ISP-A wins (2 vs 3)"],
    ["3 · Lowest MED (same neighbor AS only)", "not reached"],
    ["4 · eBGP over iBGP", "not reached"],
    ["5 · Lowest advertising Router ID", "not reached"],
  ];
  return (
    <DiagramSvg h={220} label="The lesson's simplified best-path order, stopping at AS_PATH length">
      {steps.map(([s, r], i) => {
        const decided = i === 1;
        const past = i > 1;
        return (
          <g key={s}>
            <rect x={60} y={14 + i * 40} width={330} height={30} rx={8} fill={decided ? D.success : D.box} fillOpacity={decided ? 0.16 : 1} stroke={decided ? D.success : past ? D.line : D.ospf} strokeOpacity={past ? 0.5 : 1} />
            <text x={74} y={34 + i * 40} fill={past ? D.faint : D.text} fontSize={11.5} fontWeight={600}>
              {s}
            </text>
            <text x={410} y={34 + i * 40} fill={decided ? D.success : past ? D.faint : D.muted} fontSize={11}>
              {r}
            </text>
          </g>
        );
      })}
    </DiagramSvg>
  );
}

export function NextHopDiagram() {
  return (
    <DiagramSvg h={190} label="R2 learns the route over iBGP with NEXT_HOP 192.0.2.2, a subnet R2 has no route to">
      <DNode x={110} y={60} label="R3" sub="192.0.2.2" accent={D.bgp} />
      <DNode x={320} y={60} label="R1" sub="192.0.2.1 · 10.0.12.1" w={150} />
      <DNode x={540} y={60} label="R2" sub="10.0.12.2" />
      <DLink x1={160} y1={60} x2={245} y2={60} color={D.bgp} label="eBGP" />
      <DArrow x1={396} y1={60} x2={488} y2={60} color={D.ospf} label="iBGP UPDATE" />
      <text x={320} y={118} textAnchor="middle" fill={D.text} fontSize={11}>
        203.0.113.0/24 · NEXT_HOP 192.0.2.2 (unchanged over iBGP)
      </text>
      <text x={540} y={148} textAnchor="middle" fill={D.danger} fontSize={11} fontWeight={700}>
        R2: 192.0.2.2 unreachable
      </text>
      <text x={320} y={176} textAnchor="middle" fill={D.muted} fontSize={10}>
        R2 only knows its own connected subnets (10.0.12.0/30, 198.51.100.0/30)
      </text>
    </DiagramSvg>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the BGP Lab" onPractice={openLab}>
      Same AS numbers and addresses, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

/** The lab's own command sets, run against lab states: what this page shows is what the BGP Lab prints. */
function lessonCli(s: BgNet, r: BgRouter, vendor: CliVendor, command: string) {
  const exec = { kind: "exec" } as const;
  const api: BgCliApi = { view: s, act: () => s, ios: { R1: exec, R2: exec }, setIos: () => undefined, junosEdit: { R1: false, R2: false }, setJunosEdit: () => undefined, cand: { R1: bgClone(s.cfg.r.R1), R2: bgClone(s.cfg.r.R2) }, setCand: () => undefined };
  return runGuideCli(bgRouterSets(api, r)[vendor]!, command);
}
const HEALTHY = createBgNet();
const BROKEN = bgTicket("nhs").repro.reduce((acc, a) => bgApply(acc, a), bgTicketState("nhs", 1));

export function BgpLessonGuideContent() {
  return (
    <>
      <GuideSection id="bl-mission" eyebrow="This lesson" title="What this lesson teaches" tone="bgp">
        <p>
          A company, AS65001, buys internet access from two providers: ISP-A (AS65010) on router R1 and ISP-B (AS65020) on router R2. It needs to reach 203.0.113.0/24 in AS65030. No shared map exists between these organizations, so the routers use <b className="text-pv-text">BGP</b>: they open sessions with configured neighbors, learn the destination from both ISPs, and choose one path by policy.
        </p>
        <p>You will watch the TCP connection and the BGP session come up, the routes arrive with their AS_PATH, and each router pick its best path. Then R2 can see a route it can&apos;t use, and you find out why, fix it, and prove it.</p>
        <ChecklistCard
          tone="violet"
          title="By the end of this lesson you can"
          mark="→"
          items={[
            "follow R1 and R3 from TCP 179 to Established",
            "read how 203.0.113.0/24 arrives from both ISPs, and what its AS_PATH says",
            "explain which path each router chooses, and why",
            "find out why R2 can't use a route it can see, and fix it",
            "make AS65001 prefer ISP-B without shutting any interface",
          ]}
        />
      </GuideSection>

      <GuideSection id="bl-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="R1 is dual-homed through ISP-A, R2 through ISP-B. R1↔R2 is the enterprise's internal (iBGP) session.">
          <Topology />
        </DiagramFrame>
        <FieldTable
          title="Sessions"
          accent="bgp"
          columns={["Session", "Type", "Addresses"]}
          rows={[
            ["R1 ↔ R3 (ISP-A)", "eBGP", <Mono key="1">192.0.2.1 ↔ 192.0.2.2</Mono>],
            ["R2 ↔ R4 (ISP-B)", "eBGP", <Mono key="2">198.51.100.1 ↔ 198.51.100.2</Mono>],
            ["R1 ↔ R2", "iBGP (AS65001)", <Mono key="3">10.0.12.1 ↔ 10.0.12.2</Mono>],
          ]}
        />
        <p className="text-sm text-pv-text-muted">In the guided lesson ISP-B reaches AS65030 through AS65100, so its path is one AS longer. In the BGP Lab both ISPs connect straight to AS65030 and policy has to decide; the lab also adds hosts behind R1 (H1) and R2 (H2) and read-only looking glasses on R3–R5.</p>
      </GuideSection>

      <GuideSection id="bl-ideas" eyebrow="This lesson" title="Three ideas you need" tone="cyan">
        <FlowSteps
          steps={[
            { title: "Configured neighbors, over TCP 179", body: "BGP routers are told who their neighbors are. Only an Established session exchanges routes.", tone: "tcp" },
            { title: "Routes carry their history", body: "Every eBGP hop adds its AS to the AS_PATH. A router that finds its own AS in a path drops it.", tone: "bgp" },
            { title: "One best path, chosen by policy", body: "Usable next hop first, then highest LOCAL_PREF, then shortest AS_PATH, then eBGP over iBGP.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="bl-walk" eyebrow="This lesson" title="What you will watch, step by step" tone="warning">
        <FlowSteps
          steps={[
            { title: "Transport", body: "R1 and R3 open the TCP connection to port 179.", tone: "tcp" },
            { title: "Session", body: "OPEN in both directions, then KEEPALIVEs: Idle to Established.", tone: "bgp" },
            { title: "Routes", body: "203.0.113.0/24 arrives from both ISPs, and R1 and R2 share it over iBGP.", tone: "violet" },
            { title: "Best path", body: "Each router picks one path per prefix and installs it.", tone: "success" },
            { title: "The incident", body: "R2 sees a route it can't use. You find the cause and fix it.", tone: "danger" },
            { title: "Policy", body: "AS-path prepending and LOCAL_PREF change the decision.", tone: "warning" },
          ]}
        />
        <p className="text-sm text-pv-text-muted">The sections below walk through each step on AS65001, in the same order.</p>
      </GuideSection>

      <GuideSection id="bl-problem" eyebrow="The problem" title="No shared map between networks" tone="danger">
        <p>OSPF works because every router of one organization trusts one map. Between organizations there is no such map: ISP-A and ISP-B won&apos;t flood their topology to us, and both reach AS65030, so something must decide which one we use. BGP exchanges <em>reachability</em> with each neighbor network, keeps a record of which networks a route has crossed, and lets each organization choose by its own policy.</p>
      </GuideSection>

      <GuideSection id="bl-session" eyebrow="Session" title="A session over TCP 179" tone="tcp">
        <p>R1 is configured with <Mono>neighbor 192.0.2.2 remote-as 65010</Mono>, and ISP-A&apos;s router with the mirror statement. The two open a TCP connection to port 179, exchange OPEN messages carrying their AS number and router ID, and each checks the peer&apos;s AS against the one it expects. A KEEPALIVE from each side brings the session to <b className="text-pv-text">Established</b>. Only then are routes exchanged. Despite its name, <b className="text-pv-text">Active</b> means the session is not up.</p>
        <DiagramFrame caption="TCP first, then OPEN and KEEPALIVE.">
          <SessionFlow />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bl-routes" eyebrow="Routes" title="Routes arrive with their history" tone="bgp">
        <p>AS65030 announces 203.0.113.0/24. ISP-A passes it on with the AS_PATH <Mono>65010 65030</Mono>; ISP-B with its own path. Every eBGP hop adds its AS in front, and a router that finds its own AS in a path drops it: that single rule prevents loops between organizations.</p>
        <DiagramFrame caption="The guided lesson's two candidate paths: ISP-B's transits AS65100, so it is longer.">
          <PathsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bl-ibgp" eyebrow="iBGP" title="Sharing routes inside AS65001" tone="ospf">
        <p>R1 and R2 run iBGP so each knows what the other learned. iBGP passes a route unchanged: no AS is added, and the NEXT_HOP stays the address of the external router that announced it (192.0.2.2 for ISP-A&apos;s routes). R2 has no route to ISP-A&apos;s link, so R1 is configured with <b className="text-pv-text">next-hop-self</b>: it advertises its own address, 10.0.12.1, which R2 reaches directly. Keep that in mind: it is the key to the incident.</p>
      </GuideSection>

      <GuideSection id="bl-best" eyebrow="Best path" title="One best path per prefix" tone="success">
        <p>A router can hold several paths to 203.0.113.0/24. It first ignores those whose next hop it can&apos;t reach, then compares the rest step by step: the first difference decides. Only the best path enters the routing table and is passed on.</p>
        <DiagramFrame caption="The lesson's simplified order: in the guided lesson, AS_PATH length decides.">
          <DecisionLadder />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bl-policy" eyebrow="Policy" title="Policy: the way out and the way back" tone="violet">
        <p><strong>The way out is our choice.</strong> In the lab R1 gives everything learned from ISP-A LOCAL_PREF 200 and shares it over iBGP, so R2 prefers ISP-A too (200 beats its own path at 100, before anything else is compared). <strong>The way back is other networks&apos; choice.</strong> R2 prepends our AS twice toward ISP-B, so the internet sees us further away through ISP-B and prefers ISP-A. And each router announces only our own prefixes, so we never carry traffic between the two ISPs.</p>
      </GuideSection>

      <GuideSection id="bl-verify" eyebrow="Verification" title="What healthy BGP looks like on the routers" tone="success">
        <p>Check the chain in the order it is built: session, path, choice, routing table.</p>
        <FieldTable
          title="Read the lesson on the router"
          columns={["Question", "Cisco IOS", "Junos", "What the answer proves"]}
          rows={[
            ["Is every session Established?", <Mono key="1">show ip bgp summary</Mono>, <Mono key="2">show bgp summary</Mono>, "A prefix count, not a state"],
            ["Which paths, and which is best?", <Mono key="3">show ip bgp 203.0.113.0</Mono>, <Mono key="4">show route 203.0.113.0/24 detail</Mono>, "The designed path wins, for the designed reason"],
            ["What does the routing table use?", <Mono key="5">show ip route 203.0.113.10</Mono>, <Mono key="6">show route 203.0.113.10</Mono>, "The next hop traffic really takes"],
          ]}
        />
        <p>On a healthy R2 both paths are valid, and the ISP-A path via R1 (next hop 10.0.12.1, localpref 200) is best:</p>
        <CliPanel run={lessonCli(HEALTHY, "R2", "cisco", "show ip bgp 203.0.113.0")} caption="R2 · Cisco IOS · healthy" />
        <p>And traffic confirms it: traceroutes from H1 and from H2 both leave through R1 and ISP-A.</p>
      </GuideSection>

      <GuideSection id="bl-incident" eyebrow="Incident" title="The incident: R2 can see a route it can't use" tone="danger">
        <p>Someone &quot;cleaned up&quot; R1&apos;s BGP configuration. Since then, traffic from H2 (behind R2) leaves through ISP-B, while H1 still uses ISP-A. Every session is Established.</p>
        <DiagramFrame caption="R2 learns the route over iBGP with NEXT_HOP 192.0.2.2, a subnet it has no route to.">
          <NextHopDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Why it fails", tone: "danger", tag: "cause", points: ["next-hop-self was removed on R1 toward R2", "R2 receives the ISP-A path with NEXT_HOP 192.0.2.2, which it can't reach", "An unusable path is ignored, however high its LOCAL_PREF, so R2 uses its own ISP-B path"] },
            { title: "What it can't be", tone: "warning", tag: "red herrings", points: ["A session problem: every session is Established", "A missing LOCAL_PREF: the path still carries localpref 200", "ISP-A being down: H1 still leaves through it"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="bl-investigate" eyebrow="Investigation" title="Walk the chain: session, path, choice" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "No reply, or the wrong ISP?", look: "traceroute from H2: out through ISP-B, the wrong ISP." },
            { question: "Is every session Established?", look: "show ip bgp summary on R1 and R2: yes." },
            { question: "Does R2 have the ISP-A path, and is it usable?", look: "show ip bgp 203.0.113.0 on R2: the path is there, but its next hop is (inaccessible)." },
          ]}
        />
        <CliPanel run={lessonCli(BROKEN, "R2", "cisco", "show ip bgp 203.0.113.0")} caption="R2 · Cisco IOS · during the incident" />
      </GuideSection>

      <GuideSection id="bl-repair" eyebrow="Repair" title="Repair, and prove it with traceroutes" tone="success">
        <CompareCards
          items={[
            { title: "Cisco IOS · R1", tone: "cyan", tag: "toward R2", points: ["router bgp 65001", "neighbor 10.0.12.2 next-hop-self"] },
            { title: "Junos · R1", tone: "violet", tag: "candidate → commit", points: ["set protocols bgp group INTERNAL export NHS", "commit"] },
          ]}
        />
        <ChecklistCard
          tone="success"
          title="The proof"
          mark="✓"
          items={[
            "show ip bgp 203.0.113.0 on R2: the ISP-A path has next hop 10.0.12.1 and is best",
            "R2's routing table sends 203.0.113.10 via 10.0.12.1",
            "A fresh traceroute from H2 leaves through R1 and ISP-A",
            "H1 was never affected",
          ]}
        />
      </GuideSection>

      <GuideSection id="bl-other" eyebrow="Troubleshooting" title="Other ways BGP breaks" tone="warning">
        <p>An unusable next hop is one way to lose the designed path. The lab&apos;s tickets add four more, each with its own evidence. The Deep Dive walks through all five with real Cisco and Junos output.</p>
        <CompareCards
          items={[
            { title: "A wrong remote AS", tone: "danger", tag: "session never up", points: ["The backup session stays Active", "Invisible until the primary ISP fails"] },
            { title: "The LOCAL_PREF policy is missing", tone: "violet", tag: "wrong exit", points: ["Both paths tie on LOCAL_PREF", "Each router uses its own ISP"] },
            { title: "Prepending on the wrong router", tone: "warning", tag: "wrong way back", points: ["The internet comes back through ISP-B", "The looking glass shows the longer path via ISP-A"] },
            { title: "A route leak", tone: "ip", tag: "transit by accident", points: ["We announce another ISP's prefix", "The outbound filter is missing"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="bl-model" eyebrow="Mental model" title="Diplomacy between networks" tone="violet">
        <p>Picture each organization as a country with its own embassy routers. Embassies only talk to the neighbors they were formally introduced to. They trade offers (&quot;I can reach this destination&quot;) stamped with every country the offer passed through, and each country picks one favorite per destination by walking its own ordered list of preferences. An offer that names a door you can&apos;t walk to is worthless, however attractive it looks on paper.</p>
      </GuideSection>

      <GuideSection id="bl-glossary" eyebrow="Glossary" title="Terms used in this lesson" tone="cyan">
        <Glossary
          items={[
            { term: "AS", def: "Autonomous system: a network under one administration, with a number (we are AS65001)." },
            { term: "eBGP / iBGP", def: "BGP between different ASes / inside one AS." },
            { term: "Established", def: "The only session state that exchanges routes. Active means not up." },
            { term: "AS_PATH", def: "The ASes a route crossed. Loop prevention, and a rough distance." },
            { term: "NEXT_HOP", def: "Where to send traffic for the prefix. Must be reachable for the path to be usable." },
            { term: "next-hop-self", def: "An iBGP router advertises itself as the next hop for routes it learned externally." },
            { term: "LOCAL_PREF", def: "Shared inside the AS, compared first: the highest wins. Chooses our exit." },
          ]}
        />
      </GuideSection>

      <GuideSection id="bl-recap" eyebrow="Recap" title="What you can now explain" tone="success">
        <ChecklistCard tone="cyan" title="BGP in this lesson" mark="→" items={["R1 and R3 run TCP 179, then OPEN and KEEPALIVE to Established", "203.0.113.0/24 arrives from both ISPs with different AS_PATHs", "Each router installs one best path, and only from usable paths", "Over iBGP the next hop is unchanged unless next-hop-self is set", "LOCAL_PREF picks the exit; prepending steers the way back"]} />
      </GuideSection>

      <GuideSection id="bl-practice" eyebrow="Practice" title="Practice it" tone="cyan">
        <p>You now know what each router should choose and how to prove it. The BGP Lab gives you R1 and R2 with looking glasses on R3–R5, as Cisco IOS or Junos:</p>
        <FlowSteps
          steps={[
            { title: "Learn (6 levels)", body: "The same steps as this page, one decision at a time.", tone: "violet" },
            { title: "Challenges", body: "Read an UPDATE, make ISP-B the primary without cutting anything, lose ISP-A without losing the internet, cause and stop a leak.", tone: "warning" },
            { title: "Troubleshoot (5 tickets)", body: "This lesson's incident and the four other faults above, reported as users report them.", tone: "danger" },
          ]}
        />
        <ChecklistCard
          tone="violet"
          mark="→"
          title="The guided lesson's policy challenge: how to think about it"
          items={[
            "Make AS65001 prefer ISP-B without shutting any interface",
            "Find the first criterion in the decision order that can separate the two paths",
            "Remember what a tie means for that criterion: the decision falls through to the next one",
          ]}
        />
        <PresentationBridge>See OPENs, UPDATEs growing their AS_PATH, LOCAL_PREF picking the exit and prepending steering the way back in the BGP presentation.</PresentationBridge>
        <LessonLabBridge />
        <p className="text-sm text-pv-text-muted">For the full course (messages and attributes, NEXT_HOP resolution, the full decision process, policy, real device output for every fault, a knowledge check), open the Deep Dive tab.</p>
      </GuideSection>
    </>
  );
}
