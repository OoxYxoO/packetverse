import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const RSVP_TE_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "td-why", label: "Why traffic engineering" },
  { id: "td-objects", label: "PATH and RESV objects" },
  { id: "td-hops", label: "How messages travel" },
  { id: "td-bw", label: "Bandwidth accounting" },
  { id: "td-prio", label: "Priorities & preemption" },
  { id: "td-ero", label: "Strict vs loose hops" },
  { id: "td-mbb", label: "Make-before-break" },
  { id: "td-soft", label: "Soft state & refresh" },
  { id: "td-steer", label: "Getting traffic into the tunnel" },
  { id: "td-trouble", label: "Troubleshooting ladder" },
  { id: "td-glossary", label: "Glossary" },
  { id: "td-model", label: "Mental model" },
];

function ObjectsDiagram() {
  const col = (x: number, title: string, c: string, objs: string[]) => (
    <g>
      <text x={x} y={22} textAnchor="middle" fill={c} fontSize={11.5} fontWeight={700}>
        {title}
      </text>
      {objs.map((o, i) => (
        <DPill key={o} x={x} y={46 + i * 28} text={o} color={c} w={250} />
      ))}
    </g>
  );
  return (
    <DiagramSvg h={290} label="PATH carries session, previous hop, label request, explicit route, sender template and traffic spec; RESV carries session, next hop, style, flowspec, filter spec and label">
      {col(170, "PATH ↓ (headend → tailend)", D.cyan, ["SESSION (tunnel endpoint + ID)", "RSVP_HOP (previous hop)", "TIME_VALUES (refresh)", "EXPLICIT_ROUTE (ERO)", "LABEL_REQUEST", "SESSION_ATTRIBUTE (priorities, name)", "SENDER_TEMPLATE + SENDER_TSPEC", "RECORD_ROUTE (optional)", "FAST_REROUTE (optional)"])}
      {col(470, "RESV ↑ (tailend → headend)", D.violet, ["SESSION", "RSVP_HOP (next hop)", "TIME_VALUES", "STYLE (FF / SE)", "FLOWSPEC (reserved bandwidth)", "FILTER_SPEC", "LABEL", "RECORD_ROUTE (optional)"])}
    </DiagramSvg>
  );
}

function HopsDiagram() {
  return (
    <DiagramSvg h={170} label="PATH is addressed to the tailend but processed at every hop via Router Alert; RESV is sent hop by hop to each previous hop">
      {[
        ["R1", 80],
        ["R3", 240],
        ["R5", 400],
        ["R6", 560],
      ].map(([id, x]) => (
        <DNode key={id as string} x={x as number} y={85} label={id as string} accent={D.mpls} w={84} />
      ))}
      <DArrow x1={126} y1={45} x2={514} y2={45} color={D.cyan} label="PATH: dst = tailend, Router Alert → each hop intercepts, updates PHOP, forwards" />
      <DArrow x1={354} y1={128} x2={286} y2={128} color={D.violet} />
      <DArrow x1={514} y1={128} x2={446} y2={128} color={D.violet} />
      <DArrow x1={194} y1={128} x2={126} y2={128} color={D.violet} />
      <text x={320} y={158} textAnchor="middle" fill={D.violet} fontSize={10} fontWeight={700}>
        RESV: unicast to the previous hop (PHOP) recorded from PATH, one hop at a time
      </text>
    </DiagramSvg>
  );
}

function BandwidthDiagram() {
  const x0 = 60;
  const scale = 0.5;
  return (
    <DiagramSvg h={150} label="A 1000 Mbps link with 1000 reservable: 400 reserved by another LSP, 600 available">
      <rect x={x0} y={40} width={1000 * scale} height={30} rx={6} fill="none" stroke={D.line} />
      <rect x={x0} y={40} width={400 * scale} height={30} rx={6} fill={D.warning} fillOpacity={0.35} stroke={D.warning} />
      <text x={x0 + 100} y={60} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
        reserved 400
      </text>
      <text x={x0 + 350} y={60} textAnchor="middle" fill={D.success} fontSize={10.5} fontWeight={700}>
        available 600
      </text>
      <text x={x0} y={30} fill={D.muted} fontSize={9.5}>
        0
      </text>
      <text x={x0 + 500} y={30} textAnchor="end" fill={D.muted} fontSize={9.5}>
        max reservable 1000
      </text>
      <text x={320} y={100} textAnchor="middle" fill={D.text} fontSize={10.5}>
        admission: request ≤ available (at the LSP&apos;s priority) → accept, else reject
      </text>
      <text x={320} y={122} textAnchor="middle" fill={D.muted} fontSize={10}>
        reservations are bookkeeping; they don&apos;t police or measure real traffic
      </text>
    </DiagramSvg>
  );
}

function PreemptDiagram() {
  return (
    <DiagramSvg h={170} label="A new LSP with setup priority 2 can preempt an existing LSP with hold priority 5 on a full link">
      <DNode x={120} y={50} label="LSP-GOLD" sub="setup 2 / hold 2" accent={D.success} w={150} />
      <DNode x={120} y={130} label="LSP-BRONZE" sub="setup 5 / hold 5" accent={D.warning} w={150} />
      <DArrow x1={200} y1={50} x2={380} y2={88} color={D.success} label="2 beats 5" labelDy={-10} />
      <DArrow x1={380} y1={100} x2={200} y2={130} color={D.danger} dashed label="preempted" labelDy={22} />
      <DNode x={470} y={94} label="full link" sub="no bandwidth left" accent={D.danger} w={150} />
    </DiagramSvg>
  );
}

function StrictLooseDiagram() {
  return (
    <DiagramSvg h={160} label="Strict hops must be directly connected next hops; a loose hop lets the router before it fill in the path">
      {[
        ["R1", 60],
        ["R3", 190],
        ["X", 320],
        ["R5", 450],
        ["R6", 580],
      ].map(([id, x]) => (
        <DNode key={id as string} x={x as number} y={70} label={id as string} accent={id === "X" ? D.faint : D.mpls} w={72} />
      ))}
      <DLink x1={96} y1={70} x2={154} y2={70} color={D.cyan} label="strict" labelDy={-10} />
      <DLink x1={226} y1={70} x2={284} y2={70} color={D.warning} dashed />
      <DLink x1={356} y1={70} x2={414} y2={70} color={D.warning} dashed />
      <text x={320} y={40} textAnchor="middle" fill={D.warning} fontSize={10} fontWeight={700}>
        loose hop R5: R3 expands the path itself
      </text>
      <DLink x1={486} y1={70} x2={544} y2={70} color={D.cyan} label="strict" labelDy={-10} />
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        ERO {"{"}R3 strict, R5 loose, R6 strict{"}"} · this lesson&apos;s ERO is fully strict
      </text>
    </DiagramSvg>
  );
}

function MbbDiagram() {
  return (
    <DiagramSvg h={190} label="Make-before-break: the new LSP is signaled with Shared Explicit style and shares bandwidth with the old LSP, then traffic switches and the old LSP is torn down">
      <DNode x={70} y={95} label="R1" accent={D.mpls} w={70} />
      <DNode x={570} y={95} label="R6" accent={D.mpls} w={70} />
      <DArrow x1={106} y1={80} x2={534} y2={45} color={D.faint} label="old LSP (still forwarding)" />
      <DArrow x1={106} y1={110} x2={534} y2={145} color={D.success} label="new LSP (same session, SE style)" labelDy={22} />
      <FlowStepsSvg />
    </DiagramSvg>
  );
}

function FlowStepsSvg() {
  const st = ["1 signal new", "2 new UP", "3 switch traffic", "4 tear down old"];
  return (
    <>
      {st.map((s, i) => (
        <DPill key={s} x={170 + i * 100} y={95} text={s} color={i === 2 ? D.success : D.violet} w={94} />
      ))}
    </>
  );
}

export function RsvpTeDeepDiveContent() {
  return (
    <>
      <GuideSection id="td-why" eyebrow="Background" title="Why traffic engineering exists" tone="mpls">
        <p>
          IGP routing sends all traffic for a destination over one shortest path (or equal-cost set) and ignores how full links are. Traffic engineering lets an operator place specific flows on paths chosen for bandwidth, latency, diversity or policy, and reserve capacity for them.
        </p>
        <ChecklistCard
          tone="mpls"
          mark="✓"
          title="Common uses of RSVP-TE"
          items={["Guaranteed-bandwidth tunnels between PEs.", "Using under-used links the IGP would never pick.", "Diverse paths for primary and backup services.", "Fast Reroute local protection (the next lesson)."]}
        />
      </GuideSection>

      <GuideSection id="td-objects" eyebrow="Protocol" title="What PATH and RESV carry" tone="violet">
        <DiagramFrame caption="RSVP-TE (RFC 3209) extends RSVP (RFC 2205) with label and explicit-route objects.">
          <ObjectsDiagram />
        </DiagramFrame>
        <p>
          <Mono>LABEL_REQUEST</Mono> in PATH asks downstream routers to assign labels. <Mono>LABEL</Mono> in RESV delivers each one. That&apos;s why labels are <b className="text-pv-text">downstream-assigned</b> and flow upstream.
        </p>
      </GuideSection>

      <GuideSection id="td-hops" eyebrow="Protocol" title="How PATH and RESV actually travel" tone="violet">
        <DiagramFrame caption="RSVP runs directly over IP (protocol 46). PATH is intercepted hop by hop; RESV retraces it using the recorded previous hops.">
          <HopsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="td-bw" eyebrow="Admission" title="Bandwidth accounting" tone="warning">
        <DiagramFrame caption="The same numbers the lesson's fault uses: 400 of 1000 already booked.">
          <BandwidthDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Control plane only" icon="!">
          RSVP-TE bandwidth is a booking system. Nothing stops a tunnel from sending more than it reserved unless separate policing/QoS is configured, and physical speed isn&apos;t what CSPF checks.
        </Callout>
      </GuideSection>

      <GuideSection id="td-prio" eyebrow="Admission" title="Setup and hold priorities" tone="warning">
        <p>
          Each LSP has a <b className="text-pv-text">setup</b> priority (to claim bandwidth) and a <b className="text-pv-text">hold</b> priority (to keep it), 0 (best) to 7 (worst). A new LSP may preempt an existing one if its setup priority is numerically lower than the other&apos;s hold priority. Setup must not be better than hold, or LSPs could preempt each other in a loop.
        </p>
        <DiagramFrame caption="Available bandwidth is tracked per priority level for exactly this reason.">
          <PreemptDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="td-ero" eyebrow="Paths" title="Strict vs loose ERO hops" tone="cyan">
        <DiagramFrame caption="Loose hops are expanded by the router before them, using its own view of the topology.">
          <StrictLooseDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Dynamic path", tone: "violet", tag: "CSPF", points: ["Headend computes from constraints", "Re-optimizes when better paths appear"] },
            { title: "Explicit path", tone: "cyan", tag: "operator", points: ["Hops configured by hand", "Still subject to admission control on every hop"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="td-mbb" eyebrow="Changes" title="Make-before-break" tone="success">
        <DiagramFrame caption="Resizing or re-routing without dropping traffic.">
          <MbbDiagram />
        </DiagramFrame>
        <p>
          With <b className="text-pv-text">Shared Explicit (SE)</b> style, the old and new LSP instances of the same session share a reservation on common links, so the new one isn&apos;t blocked by the old one&apos;s bandwidth. This lesson&apos;s 700 Mbps fix re-signals from DOWN, a simplification; real networks typically resize with make-before-break.
        </p>
      </GuideSection>

      <GuideSection id="td-soft" eyebrow="Protocol" title="Soft state and refresh" tone="violet">
        <FlowSteps
          steps={[
            { title: "Refresh", body: "Every hop periodically re-sends PATH downstream and RESV upstream (classically every ~30 s).", tone: "violet" },
            { title: "Timeout", body: "State not refreshed for several intervals is removed, freeing its bandwidth.", tone: "warning" },
            { title: "Teardown", body: "PathTear / ResvTear remove state explicitly without waiting.", tone: "danger" },
            { title: "Scaling aids", body: "Refresh reduction (RFC 2961) bundles and summarizes refreshes.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="td-steer" eyebrow="Forwarding" title="Getting traffic into the tunnel" tone="success">
        <p>An LSP that is UP carries nothing until something steers traffic into it:</p>
        <FieldTable
          title="Common steering methods"
          accent="success"
          columns={["Method", "Idea"]}
          rows={[
            ["Static route", "Point a prefix at the tunnel interface"],
            ["Autoroute / IGP shortcut", "The headend's SPF treats the tunnel as a link to the tailend"],
            ["Forwarding adjacency", "The tunnel is advertised into the IGP so other routers use it too"],
            ["BGP next-hop resolution", "Service routes whose next hop is the tailend resolve over the tunnel"],
            ["Class/policy-based", "Only selected traffic classes use the tunnel"],
          ]}
        />
      </GuideSection>

      <GuideSection id="td-trouble" eyebrow="Operations" title="Troubleshooting ladder" tone="danger">
        <FieldTable
          title="Bottom-up: stop at the first failing layer"
          accent="danger"
          columns={["Layer", "Question", "Typical command idea"]}
          rows={[
            ["IGP", "Is the tailend reachable?", "show ip route"],
            ["TE flooding", "Are all links in the TED with TE attributes?", "show mpls traffic-eng topology"],
            ["RSVP enabled", "Is RSVP on every interface of the path?", "show ip rsvp interface"],
            ["CSPF", "Does any path satisfy the constraints?", "show mpls traffic-eng tunnels (path option / failure reason)"],
            ["Signaling", "Did PATH reach the tailend and RESV return?", "show ip rsvp sender / reservation"],
            ["Labels", "Is forwarding state installed at each hop?", "show mpls forwarding-table"],
            ["Steering", "Does traffic actually use the tunnel?", "show ip cef / tunnel counters"],
          ]}
        />
        <Callout tone="warning" title={'"No path" is a CSPF answer, not a signaling failure'} icon="!">
          If CSPF finds nothing, no PATH is sent at all. Check constraints against available bandwidth and affinities first, before looking for RSVP problems.
        </Callout>
      </GuideSection>

      <GuideSection id="td-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Setup / hold priority", def: "0–7 values controlling who may preempt whom." },
            { term: "Preemption", def: "Tearing down a lower-priority LSP to admit a higher-priority one." },
            { term: "FF / SE style", def: "Fixed Filter (per-sender) vs Shared Explicit (shared by listed senders) reservation." },
            { term: "Make-before-break", def: "Signal the new LSP before removing the old one." },
            { term: "PHOP", def: "Previous hop recorded from PATH; where RESV is sent." },
            { term: "Loose hop", def: "ERO hop that need not be directly connected." },
            { term: "Autoroute", def: "Headend uses the tunnel as a shortcut in its own SPF." },
            { term: "Auto-bandwidth", def: "Periodically resizes the reservation to measured traffic." },
          ]}
        />
      </GuideSection>

      <GuideSection id="td-model" eyebrow="Recap" title="Mental model" tone="mpls">
        <div className="rounded-2xl border border-pv-mpls/30 bg-gradient-to-br from-pv-mpls/10 to-pv-violet/5 p-5 text-sm leading-relaxed text-pv-text">
          RSVP-TE is a booking system glued to a label distributor. CSPF checks the books (TED) and picks a route. PATH walks the route asking for a room and a label. RESV walks back confirming the booking and handing out labels. The data plane then follows labels, oblivious to the booking. Anything that changes the books (other tunnels, priorities, ceilings) can change whether a tunnel can exist at all.
        </div>
      </GuideSection>
    </>
  );
}
