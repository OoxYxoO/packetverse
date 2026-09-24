import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DLink, DNode, DPill, DRegion, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const BGP_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "bl-mission", label: "The mission" },
  { id: "bl-topology", label: "Who connects to whom" },
  { id: "bl-why", label: "Why not OSPF?" },
  { id: "bl-tcp", label: "TCP/179 first" },
  { id: "bl-fsm", label: "OPEN → KEEPALIVE → Established" },
  { id: "bl-sessions", label: "The other two sessions" },
  { id: "bl-updates", label: "Two UPDATEs, two AS_PATHs" },
  { id: "bl-ibgp", label: "iBGP shares both paths" },
  { id: "bl-bestpath", label: "Best path at R1" },
  { id: "bl-r2", label: "R2's decision" },
  { id: "bl-nexthop", label: "The NEXT_HOP fault" },
  { id: "bl-nhs", label: "next-hop-self" },
  { id: "bl-prepend", label: "AS-path prepending" },
  { id: "bl-localpref", label: "Local Preference" },
  { id: "bl-challenge", label: "The policy challenge" },
  { id: "bl-recap", label: "Recap" },
];

function Topology({ nhFault }: { nhFault?: boolean }) {
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

function SessionFlow() {
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

function PathsDiagram() {
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

function DecisionLadder() {
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

function NextHopDiagram() {
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

export function BgpLessonGuideContent() {
  return (
    <>
      <GuideSection id="bl-mission" eyebrow="Introduction" title="The mission: AS65001 reaches 203.0.113.0/24" tone="bgp">
        <p>
          The enterprise (AS65001) has two routers, R1 and R2. Each knows only its connected networks, and neither knows how to reach <Mono>203.0.113.0/24</Mono>, a prefix inside a different autonomous system (AS65030). You build the BGP sessions, watch the best-path decision run on real attributes, fix a NEXT_HOP fault, and then steer the result with policy.
        </p>
        <Callout tone="cyan" title="Scope of this simulation" icon="i">
          The lesson models TCP/179, the BGP FSM, eBGP + iBGP, OPEN/KEEPALIVE/UPDATE, NEXT_HOP, AS_PATH, LOCAL_PREF, a basic MED explanation, <b>a deliberately simplified best-path order</b>, AS-path prepending and one NEXT_HOP fault. Route reflectors, communities, MP-BGP and RPKI are out of scope here.
        </Callout>
      </GuideSection>

      <GuideSection id="bl-topology" eyebrow="Topology" title="Who connects to whom" tone="bgp">
        <DiagramFrame caption="R1 is dual-homed through ISP-A, R2 through ISP-B. R1↔R2 is the enterprise's internal (iBGP) session.">
          <Topology />
        </DiagramFrame>
        <FieldTable
          title="Sessions in this lesson"
          accent="bgp"
          columns={["Session", "Type", "Addresses"]}
          rows={[
            ["R1 ↔ R3 (ISP-A)", "eBGP", <Mono key="1">192.0.2.1 ↔ 192.0.2.2</Mono>],
            ["R2 ↔ R4 (ISP-B)", "eBGP", <Mono key="2">198.51.100.1 ↔ 198.51.100.2</Mono>],
            ["R1 ↔ R2", "iBGP (AS65001)", <Mono key="3">10.0.12.1 ↔ 10.0.12.2</Mono>],
          ]}
        />
      </GuideSection>

      <GuideSection id="bl-why" eyebrow="Motivation" title="Why not just extend OSPF?" tone="violet">
        <p>
          An IGP such as OSPF runs <b className="text-pv-text">inside</b> one administrative domain and trusts every router in it. Exchanging routes <b className="text-pv-text">between</b> independent organizations needs a protocol built for policy and scale. That is BGP: every route carries the list of ASes it crossed, and each AS applies its own policy.
        </p>
      </GuideSection>

      <GuideSection id="bl-tcp" eyebrow="Transport" title="TCP port 179 comes first" tone="tcp">
        <p>
          BGP has no transport of its own. It rides a normal TCP connection to <b className="text-pv-text">port 179</b>, so a TCP three-way handshake between R1 and R3 must complete before any BGP message can flow. In this lesson TCP connects on the first try, so the FSM moves Idle → Connect and never needs the Active (retry) state.
        </p>
      </GuideSection>

      <GuideSection id="bl-fsm" eyebrow="Session" title="OPEN → KEEPALIVE → Established" tone="bgp">
        <DiagramFrame caption="OPEN carries identity (AS number and BGP Identifier) plus the Hold Time; the first KEEPALIVE confirms it.">
          <SessionFlow />
        </DiagramFrame>
        <p>
          Each side checks the peer&apos;s OPEN, above all that the <b className="text-pv-text">AS number</b> matches what it was configured to expect, and the <b className="text-pv-text">BGP Identifier</b> identifies the speaker. A KEEPALIVE from each side then moves the session from OpenConfirm to <b className="text-pv-text">Established</b>.
        </p>
      </GuideSection>

      <GuideSection id="bl-sessions" eyebrow="Meanwhile" title="The other two sessions" tone="bgp">
        <p>The identical TCP → OPEN → KEEPALIVE sequence runs on R2↔R4 (eBGP to ISP-B) and on R1↔R2 (iBGP inside AS65001). The lesson fast-forwards these.</p>
      </GuideSection>

      <GuideSection id="bl-updates" eyebrow="Routes" title="Two UPDATEs, two AS_PATHs" tone="bgp">
        <p>
          R3 advertises <Mono>203.0.113.0/24</Mono> to R1 with AS_PATH <Mono>65010 65030</Mono>. R4 advertises the same prefix to R2, but its path transits AS65100: <Mono>65020 65100 65030</Mono>.
        </p>
        <DiagramFrame caption="The AS_PATH is both a loop-prevention record and a (coarse) distance measure.">
          <PathsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bl-ibgp" eyebrow="Inside the AS" title="iBGP gives both routers both paths" tone="ospf">
        <p>R1 and R2 advertise what each learned externally to one another over iBGP. Now each router holds two candidates: its own eBGP path and the other router&apos;s path relayed over iBGP.</p>
      </GuideSection>

      <GuideSection id="bl-bestpath" eyebrow="Decision" title="Best path at R1" tone="success">
        <p>R1 compares its two paths with the lesson&apos;s best-path order, stopping at the first criterion that separates them:</p>
        <DiagramFrame caption="The lesson's simplified order. Real implementations have more steps (see the BGP Deep Dive).">
          <DecisionLadder />
        </DiagramFrame>
        <Callout tone="cyan" title="Why MED doesn't decide here" icon="i">
          MED is only compared between paths from the <b>same neighboring AS</b>. ISP-A (AS65010) and ISP-B (AS65020) are different neighbors, so their MEDs of 50 and 20 aren&apos;t compared. The decision was made earlier anyway.
        </Callout>
      </GuideSection>

      <GuideSection id="bl-r2" eyebrow="Decision" title="R2 reaches the same conclusion" tone="success">
        <p>R2 compares its own ISP-B path (3 ASes) with ISP-A&apos;s path relayed by R1 (2 ASes) and also prefers ISP-A by AS_PATH length. Both routers agree: AS65001 exits via ISP-A.</p>
      </GuideSection>

      <GuideSection id="bl-nexthop" eyebrow="Troubleshooting" title="The NEXT_HOP fault" tone="danger">
        <p>
          The complaint: &quot;R2 can see 203.0.113.0/24 in BGP, but traffic can&apos;t use the route correctly.&quot; The session is Established and the prefix is present, so the problem is in the route&apos;s attributes.
        </p>
        <DiagramFrame caption="By default iBGP doesn't change NEXT_HOP, so R2 receives ISP-A's own interface address as the next hop.">
          <NextHopDiagram />
        </DiagramFrame>
        <p>A BGP route is only usable if its NEXT_HOP resolves through the routing table. In this lesson R2 knows only its own connected subnets, so <Mono>192.0.2.2</Mono> doesn&apos;t resolve.</p>
      </GuideSection>

      <GuideSection id="bl-nhs" eyebrow="Fix" title="next-hop-self" tone="success">
        <p>
          The fix is <b className="text-pv-text">next-hop-self</b> on the iBGP session: R1 and R2 rewrite NEXT_HOP to their own iBGP address before relaying an external route, so R2 now sees <Mono>10.0.12.1</Mono>, which it can reach directly. (Advertising the external link subnets into the IGP is another common real-world fix.)
        </p>
      </GuideSection>

      <GuideSection id="bl-prepend" eyebrow="Policy" title="AS-path prepending" tone="violet">
        <p>
          Prepending repeats an AS number to make a path <b className="text-pv-text">look longer</b>. In the lesson ISP-B&apos;s path arrives with its AS prepended twice more, which lengthens it further. Networks usually prepend on their own outbound advertisements to influence how <em>others</em> reach them (inbound traffic), and it is a hint, not a guarantee.
        </p>
      </GuideSection>

      <GuideSection id="bl-localpref" eyebrow="Policy" title="Local Preference" tone="violet">
        <p>
          LOCAL_PREF is exchanged only inside the AS (over iBGP) and is compared <b className="text-pv-text">before</b> AS_PATH, so a higher LOCAL_PREF can override a shorter path. It is the classic tool for choosing which exit your own AS uses (outbound traffic). In the lesson, raising ISP-B&apos;s LOCAL_PREF to 200 moves the whole AS to ISP-B.
        </p>
        <FlowSteps
          steps={[
            { title: "Set on ingress", body: "Policy on the eBGP session assigns LOCAL_PREF to routes from that ISP.", tone: "violet" },
            { title: "Carried over iBGP", body: "Every router in the AS sees the same preference.", tone: "ospf" },
            { title: "Compared first", body: "In the lesson's order, the highest LOCAL_PREF wins before AS_PATH is even considered.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="bl-challenge" eyebrow="Engineer challenge" title="The policy challenge: how to think about it" tone="violet">
        <p>LOCAL_PREF is reset to 100/100 and the prepend is cleared, so ISP-A wins again. Make AS65001 prefer ISP-B without shutting any interface.</p>
        <ChecklistCard
          tone="violet"
          mark="→"
          title="Method (no spoilers)"
          items={[
            "Find the first criterion in the lesson's order that can separate the two paths.",
            "Remember what a tie means for that criterion: the decision falls through to the next one.",
            "After applying a value, check which path is marked best and what the routing table installs.",
          ]}
        />
      </GuideSection>

      <GuideSection id="bl-recap" eyebrow="Recap" title="What you saw" tone="violet">
        <div className="rounded-2xl border border-pv-bgp/30 bg-gradient-to-br from-pv-bgp/10 to-pv-violet/5 p-5 text-sm leading-relaxed text-pv-text">
          TCP/179 carried OPEN and KEEPALIVE to reach Established. UPDATEs delivered one prefix with two AS_PATHs, iBGP gave both routers both paths, and the best-path order picked ISP-A on AS_PATH length. A route is only usable if its NEXT_HOP resolves (next-hop-self fixed that), and policy decides the rest: prepending shapes how others see you, LOCAL_PREF chooses your own exit.
        </div>
      </GuideSection>
    </>
  );
}
