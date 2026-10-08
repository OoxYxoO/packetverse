import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { LadderDiagram, SeqLanes, WorkflowDiagram } from "@/components/lesson/TroubleshootingGuideSvg";
import { IP, OSPF } from "@/lib/sim-engine/scenarios/troubleshootingRouting";

export const RT_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "rtl-mission", label: "The mission" },
  { id: "rtl-method", label: "The method" },
  { id: "rtl-topology", label: "Topology" },
  { id: "rtl-ospf", label: "OSPF state" },
  { id: "rtl-rib", label: "R1's table" },
  { id: "rtl-path", label: "A healthy path" },
  { id: "rtl-scope", label: "Scoping" },
  { id: "rtl-lookup", label: "R1's lookup" },
  { id: "rtl-order", label: "Selection order" },
  { id: "rtl-stop", label: "Where it stops" },
  { id: "rtl-trace", label: "Traceroute" },
  { id: "rtl-ladder", label: "Evidence ladder" },
  { id: "rtl-verify", label: "Repair & verify" },
  { id: "rtl-glossary", label: "Glossary" },
];

function TopologyDiagram() {
  return (
    <DiagramSvg h={190} label="CLIENT to R1 to R2 to R3, with SERVER-A and SERVER-B on 172.16.20.0/24 behind R3; OSPF area 0 between the routers">
      <rect x={140} y={50} width={370} height={90} rx={14} fill={D.violet} fillOpacity={0.05} stroke={D.violet} strokeOpacity={0.4} strokeDasharray="6 5" />
      <text x={152} y={66} fill={D.violet} fontSize={9.5} fontWeight={700}>
        OSPF area 0
      </text>
      <DNode x={60} y={100} label="CLIENT" sub={IP.client} accent={D.cyan} w={100} />
      <DNode x={200} y={100} label="R1" sub="gw 10.10.10.1" accent={D.violet} w={100} />
      <DNode x={325} y={100} label="R2" sub="192.0.2.1 | .2" accent={D.violet} w={100} />
      <DNode x={450} y={100} label="R3" sub="172.16.20.1" accent={D.violet} w={100} />
      <DNode x={585} y={50} label="SERVER-A" sub={IP.srvA} accent={D.success} w={100} />
      <DNode x={585} y={150} label="SERVER-B" sub={IP.srvB} accent={D.success} w={100} />
      <DLink x1={110} y1={100} x2={150} y2={100} />
      <DLink x1={250} y1={100} x2={275} y2={100} />
      <DLink x1={375} y1={100} x2={400} y2={100} />
      <DLink x1={500} y1={90} x2={535} y2={60} />
      <DLink x1={500} y1={110} x2={535} y2={140} />
      <text x={320} y={182} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        /31 transit links, OSPF cost 10 each; the two servers share one subnet and one path.
      </text>
    </DiagramSvg>
  );
}

function OspfDiagram() {
  return (
    <DiagramSvg h={150} label="OSPF adjacencies Full and three router LSAs, identical before, during and after the incident">
      <DTable
        x={60}
        y={8}
        title="OSPF — identical in every phase of this lesson"
        cols={[
          { label: "ITEM", w: 200 },
          { label: "STATE", w: 320 },
        ]}
        rows={[
          ["R1–R2 adjacency", "Full"],
          ["R2–R3 adjacency", "Full"],
          ["Router LSAs", OSPF.lsas.map((l) => `${l.adv} ${l.seq}`).join(" · ")],
          ["R1 → 172.16.20.0/24", "via 192.0.2.1 · cost 30"],
        ]}
      />
    </DiagramSvg>
  );
}

function RibDiagram() {
  return (
    <DiagramSvg h={150} label="R1's baseline routing table: two connected routes and two OSPF routes, including 172.16.20.0/24 via 192.0.2.1">
      <DTable
        x={40}
        y={8}
        title="R1 routing table (baseline)"
        cols={[
          { label: "PREFIX", w: 160 },
          { label: "SOURCE", w: 110 },
          { label: "NEXT HOP / ACTION", w: 290 },
        ]}
        rows={[
          ["10.10.10.0/24", "connected", "ge-0/0/0"],
          ["192.0.2.0/31", "connected", "ge-0/0/1"],
          ["192.0.2.2/31", "OSPF", "via 192.0.2.1 · metric 20"],
          ["172.16.20.0/24", "OSPF", "via 192.0.2.1 · metric 30"],
        ]}
        highlight={{ row: 3, color: D.success }}
      />
    </DiagramSvg>
  );
}

function PathDiagram() {
  return (
    <DiagramSvg h={120} label="A healthy echo to SERVER-A: TTL 64 at CLIENT, 63 after R1, 62 after R2, 61 at SERVER-A">
      {[
        { x: 60, n: "CLIENT", t: "TTL 64" },
        { x: 200, n: "R1", t: "→ 63" },
        { x: 330, n: "R2", t: "→ 62" },
        { x: 460, n: "R3", t: "→ 61" },
        { x: 590, n: "SERVER-A", t: "TTL 61" },
      ].map((h, i, all) => (
        <g key={h.n}>
          <DNode x={h.x} y={50} label={h.n} sub={h.t} accent={i === 0 || i === 4 ? D.cyan : D.violet} w={96} />
          {i < all.length - 1 && <DArrow x1={h.x + 50} y1={50} x2={all[i + 1].x - 50} y2={50} color={D.ip} width={1.4} />}
        </g>
      ))}
      <text x={320} y={104} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Destination 172.16.20.20 unchanged end to end; each router decrements TTL and rewrites Ethernet.
      </text>
    </DiagramSvg>
  );
}

function ScopeDiagram() {
  return (
    <DiagramSvg h={150} label="During the incident SERVER-B is reachable through the same OSPF route while SERVER-A is not">
      <DTable
        x={50}
        y={8}
        title="Same subnet, same path, different outcome"
        cols={[
          { label: "TEST", w: 220 },
          { label: "SERVER-A .20", w: 150 },
          { label: "SERVER-B .30", w: 150 },
        ]}
        rows={[
          ["ping from CLIENT", "0/5", "5/5"],
          ["ping from R3", "5/5", "—"],
          ["OSPF route used", "?", "172.16.20.0/24"],
          ["R2 receives packets", "no", "yes"],
        ]}
        highlight={{ row: 0, color: D.warning }}
      />
    </DiagramSvg>
  );
}

function LookupDiagram() {
  return (
    <DiagramSvg h={150} label="R1 lookup for 172.16.20.20: both the OSPF /24 and the static /32 discard match; the /32 is longer and wins; its action is discard">
      <DTable
        x={40}
        y={8}
        title={`R1 lookup — destination ${IP.srvA} (incident)`}
        cols={[
          { label: "MATCHING ROUTE", w: 200 },
          { label: "LENGTH", w: 80 },
          { label: "SOURCE", w: 100 },
          { label: "RESULT", w: 180 },
        ]}
        rows={[
          ["172.16.20.20/32 → discard", "32", "static", "← longest: selected"],
          ["172.16.20.0/24 via 192.0.2.1", "24", "OSPF", "present, not selected"],
        ]}
        highlight={{ row: 0, color: D.danger }}
      />
      <text x={320} y={112} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        For {IP.srvB} only the /24 matches, so it is forwarded normally.
      </text>
    </DiagramSvg>
  );
}

function OrderDiagram() {
  const steps = ["collect matches", "longest prefix", "pref (tie only)", "metric (same src)", "FIB action"];
  return (
    <DiagramSvg h={110} label="Selection order: collect matching routes, longest prefix first, then preference only among equal prefixes, then metric within one source, then the FIB action">
      {steps.map((t, i) => {
        const x = 70 + i * 125;
        return (
          <g key={t}>
            <DPill x={x} y={40} text={t} color={i === 1 ? D.success : i === 2 ? D.warning : D.cyan} w={118} />
            {i < steps.length - 1 && <DArrow x1={x + 59} y1={40} x2={x + 66} y2={40} color={D.muted} width={1.2} />}
          </g>
        );
      })}
      <text x={320} y={86} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Preference can never make a /24 beat a /32 — they are different prefixes.
      </text>
    </DiagramSvg>
  );
}

function StopDiagram() {
  return (
    <DiagramSvg h={150} label="The echo to SERVER-A reaches R1 and is discarded there; R2 receives nothing">
      <SeqLanes
        lanes={[
          { x: 90, label: "CLIENT", color: D.cyan },
          { x: 260, label: "R1", color: D.violet },
          { x: 420, label: "R2", color: D.violet },
          { x: 570, label: "SERVER-A", color: D.success },
        ]}
        msgs={[
          { from: 0, to: 1, label: "echo → .20 · TTL 64" },
          { from: 1, to: 2, label: "/32 discard", drop: true },
          { from: 2, to: 3, label: "(nothing arrives)", color: D.faint },
        ]}
      />
    </DiagramSvg>
  );
}

function TraceDiagram() {
  return (
    <DiagramSvg h={120} label="Traceroute to SERVER-B shows four hops; to SERVER-A only the first hop answers and the rest time out">
      <DTable
        x={40}
        y={8}
        title="traceroute during the incident"
        cols={[
          { label: "TARGET", w: 150 },
          { label: "HOPS", w: 410 },
        ]}
        rows={[
          [IP.srvB, "10.10.10.1 → 192.0.2.1 → 192.0.2.3 → 172.16.20.30"],
          [IP.srvA, "10.10.10.1 → * * * → * * * → * * *"],
        ]}
        highlight={{ row: 1, color: D.warning }}
      />
      <text x={320} y={104} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Silence after R1 matches a silent discard at R1 (a reject route would answer &quot;unreachable&quot;).
      </text>
    </DiagramSvg>
  );
}

function VerifyDiagram() {
  return (
    <DiagramSvg h={150} label="Before and after: lookup for .20 changes from the /32 discard to the /24 via R2; SERVER-A 0 of 5 to 5 of 5; OSPF unchanged">
      <DTable
        x={40}
        y={8}
        title="Same tests, before and after"
        cols={[
          { label: "CHECK", w: 200 },
          { label: "INCIDENT", w: 170 },
          { label: "AFTER REPAIR", w: 190 },
        ]}
        rows={[
          ["R1 lookup 172.16.20.20", "/32 discard", "/24 via 192.0.2.1"],
          ["R2 receives .20 packets", "no", "yes"],
          ["SERVER-A ping / trace", "0/5 · stops at R1", "5/5 · 4 hops"],
          ["OSPF", "Full, unchanged", "Full, unchanged"],
        ]}
        highlight={{ row: 0, color: D.success }}
      />
    </DiagramSvg>
  );
}

export function RtLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="rtl-mission" eyebrow="Mission" title="A healthy protocol, a broken destination" tone="cyan">
        <p>Routing protocols supply candidate routes; the forwarding table decides what happens to each packet. This lesson troubleshoots a blackhole that no routing-protocol check will ever reveal — by reading the router&apos;s own lookup for the failing address.</p>
      </GuideSection>

      <GuideSection id="rtl-method" eyebrow="Method" title="Start where the evidence points" tone="violet">
        <DiagramFrame caption="Evidence can scope a problem above Layer 1 immediately — use it.">
          <DiagramSvg h={82} label="Troubleshooting workflow">
            <WorkflowDiagram notes={["which server?", "what works?", "lookups, counts", "one route", "far-side ping", "one change", "same tests"]} />
          </DiagramSvg>
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rtl-topology" eyebrow="Topology" title="Three routers, one server subnet" tone="cyan">
        <DiagramFrame caption="Both servers depend on exactly the same path.">
          <TopologyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rtl-ospf" eyebrow="Control plane" title="OSPF is healthy — and stays healthy" tone="violet">
        <DiagramFrame caption="Nothing in OSPF changes during this incident.">
          <OspfDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rtl-rib" eyebrow="Baseline" title="R1's routing table" tone="ip">
        <DiagramFrame caption="One route covers the whole server LAN.">
          <RibDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rtl-path" eyebrow="Baseline" title="A healthy path" tone="ip">
        <DiagramFrame caption="TTL counts routers.">
          <PathDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rtl-scope" eyebrow="Incident" title="Scope with a working neighbor" tone="warning">
        <DiagramFrame caption="SERVER-B rules out the links, OSPF, R2, R3 and the LAN.">
          <ScopeDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rtl-lookup" eyebrow="Evidence" title="R1's lookup for the failing address" tone="danger">
        <DiagramFrame caption="Present is not the same as selected.">
          <LookupDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rtl-order" eyebrow="Route selection" title="The order of decisions" tone="success">
        <DiagramFrame caption="Prefix length is evaluated first.">
          <OrderDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="A common misconception">
          &quot;Static has a better administrative distance, so it wins&quot; is the wrong reason here. The /32 wins because it is more specific; even with the worst preference it would still win for 172.16.20.20.
        </Callout>
      </GuideSection>

      <GuideSection id="rtl-stop" eyebrow="Evidence" title="Where the packet disappears" tone="danger">
        <DiagramFrame caption="Absence downstream + a rising discard counter = the drop point.">
          <StopDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rtl-trace" eyebrow="Evidence" title="Traceroute" tone="violet">
        <DiagramFrame caption="The last hop that answers bounds the problem.">
          <TraceDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rtl-ladder" eyebrow="Ladder" title="The lowest broken dependency" tone="cyan">
        <DiagramFrame caption="Everything below and around the FIB entry is healthy.">
          <DiagramSvg h={130} label="Evidence ladder for this incident">
            <LadderDiagram
              rows={[
                { rung: "Physical / Ethernet", evidence: "SERVER-B path works", status: "ok" },
                { rung: "IP addressing", evidence: "SERVER-A answers R3", status: "ok" },
                { rung: "Routing protocol", evidence: "OSPF Full, LSDB unchanged", status: "ok" },
                { rung: "Forwarding (FIB)", evidence: "R1: .20 → /32 discard", status: "fail" },
                { rung: "Transport / app", evidence: "SERVER-A 0/5 (symptom)", status: "suspect" },
              ]}
            />
          </DiagramSvg>
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rtl-verify" eyebrow="Verify" title="Remove one route, prove it with packets" tone="success">
        <DiagramFrame caption="OSPF was never touched.">
          <VerifyDiagram />
        </DiagramFrame>
        <ChecklistCard tone="success" title="Verified" mark="✓" items={["R1 lookup for 172.16.20.20: 172.16.20.0/24 via 192.0.2.1", "R2 and SERVER-A receive the echo; TTL 64 → 61", "SERVER-A 5/5, traceroute 4 hops; SERVER-B still 5/5", "OSPF adjacencies and LSDB unchanged"]} />
        <p>
          On real routers, look up the failing address itself: Juniper-style <Mono>show route 172.16.20.20</Mono>, Cisco-style <Mono>show ip route 172.16.20.20</Mono>.
        </p>
      </GuideSection>

      <GuideSection id="rtl-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <Glossary
          items={[
            { term: "RIB", def: "All usable routes from every source (connected, static, OSPF, BGP…)." },
            { term: "FIB", def: "The forwarding table: the best route per prefix, used for every packet lookup." },
            { term: "Longest-prefix match", def: "Among matching routes, the most specific prefix wins." },
            { term: "Preference / administrative distance", def: "Ranks route sources for the SAME prefix." },
            { term: "Discard route", def: "A route whose action is to drop matching packets silently." },
            { term: "Blackhole", def: "A place where traffic is silently dropped." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
