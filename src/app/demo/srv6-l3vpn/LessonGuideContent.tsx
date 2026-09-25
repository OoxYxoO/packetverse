import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DPill, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DHeaderColumn, Srv6Topology, type Srv6Pos } from "@/components/lesson/Srv6GuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const SRV6L_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "ll-mission", label: "The mission" },
  { id: "ll-topology", label: "Topology and roles" },
  { id: "ll-identities", label: "Two PE identities" },
  { id: "ll-vrf", label: "VRF, RD and RT" },
  { id: "ll-sids", label: "Per-VRF Service SIDs" },
  { id: "ll-route", label: "Anatomy of the VPN route" },
  { id: "ll-install", label: "PE1's install checks" },
  { id: "ll-dataplane", label: "CE1 → CE2 across the core" },
  { id: "ll-shared", label: "One SID, two CEs" },
  { id: "ll-reverse", label: "Reverse direction and IPv6" },
  { id: "ll-labs", label: "Labs and previews" },
  { id: "ll-fault", label: "The broken-service incident" },
  { id: "ll-mistakes", label: "Common mistakes" },
  { id: "ll-glossary", label: "Glossary" },
  { id: "ll-recap", label: "Mental model" },
];

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
    <>
      <GuideSection id="ll-mission" eyebrow="Introduction" title="The mission: L3VPN over an SRv6 core" tone="ip">
        <p>
          You know MPLS L3VPN: VRFs, RD, RT and MP-BGP VPN routes, with an MPLS VPN label as the egress instruction. This lesson runs a VPN for the same customer over an IPv6/SRv6 core and checks, piece by piece, what the new data plane changes.
        </p>
        <Callout tone="cyan" title="Scope of this simulation" icon="i">
          One VRF (CUST-A) on PE1 and PE2, per-VRF End.DT4/End.DT6 Service SIDs (RFC 9252), shortest-path forwarding with a single Service SID, and RR1 as a control-plane-only route reflector. CE-PE routing is outside the lesson&apos;s scope.
        </Callout>
      </GuideSection>

      <GuideSection id="ll-topology" eyebrow="Setup" title="Topology and roles" tone="ospf">
        <DiagramFrame caption="Customer edges, provider edges, and a plain-IPv6 provider core.">
          <TopologyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ll-identities" eyebrow="Setup" title="Two PE identities" tone="violet">
        <DiagramFrame caption="PE1 has the same split: 2001:db8:ffff::1 and 2001:db8:100:1::/64.">
          <IdentitiesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ll-vrf" eyebrow="VPN state" title="VRF, RD and RT" tone="bgp">
        <FieldTable
          title="CUST-A"
          accent="bgp"
          columns={["Item", "PE1", "PE2"]}
          rows={[
            ["RD", <Mono key="1">65000:1</Mono>, <Mono key="2">65000:2</Mono>],
            ["Export / import RT", <Mono key="3">65000:100</Mono>, <Mono key="4">65000:100</Mono>],
            ["Local IPv4 routes", "10.10.1.0/24 (CE1)", "10.20.1.0/24 (CE2), 10.20.2.0/24 (CE3)"],
            ["Local IPv6 routes", "2001:db8:ca:10::/64", "2001:db8:ca:20::/64, 2001:db8:ca:30::/64"],
          ]}
        />
      </GuideSection>

      <GuideSection id="ll-sids" eyebrow="Service SIDs" title="Per-VRF Service SIDs" tone="violet">
        <FieldTable
          title="Instantiated Service SIDs"
          accent="violet"
          columns={["SID", "Owner", "Behavior", "Table"]}
          rows={[
            [<Mono key="1">2001:db8:100:1:13::</Mono>, "PE1", "End.DT4", "CUST-A (IPv4)"],
            [<Mono key="2">2001:db8:100:1:12::</Mono>, "PE1", "End.DT6", "CUST-A (IPv6)"],
            [<Mono key="3">2001:db8:100:2:13::</Mono>, "PE2", "End.DT4", "CUST-A (IPv4)"],
            [<Mono key="4">2001:db8:100:2:12::</Mono>, "PE2", "End.DT6", "CUST-A (IPv6)"],
          ]}
        />
        <p>Function values match Endpoint Behaviors (0x13 End.DT4, 0x12 End.DT6); 0x14 stays reserved for End.DT46.</p>
      </GuideSection>

      <GuideSection id="ll-route" eyebrow="Control plane" title="Anatomy of the VPN route" tone="bgp">
        <DiagramFrame caption="Built step by step in the lesson, then advertised in one UPDATE.">
          <RouteDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ll-install" eyebrow="Control plane" title="PE1's install checks" tone="warning">
        <DiagramFrame caption="Three independent checks before a route is usable.">
          <InstallDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ll-dataplane" eyebrow="Data plane" title="CE1 → CE2 across the core" tone="ip">
        <DiagramFrame caption="Shortest-path service forwarding.">
          <DataPlaneDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ll-shared" eyebrow="Data plane" title="One SID, two CEs" tone="success">
        <FlowSteps
          steps={[
            { title: "CE1 → 10.20.1.10", body: "PE1 uses PE2's End.DT4 SID; PE2's CUST-A lookup matches 10.20.1.0/24 → CE2.", tone: "success" },
            { title: "CE1 → 10.20.2.10", body: "Same Service SID; PE2's CUST-A lookup matches 10.20.2.0/24 → CE3.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="ll-reverse" eyebrow="Data plane" title="Reverse direction and IPv6" tone="cyan">
        <CompareCards
          items={[
            { title: "CE2 → CE1", tone: "cyan", tag: "reverse", points: ["PE1 advertised 10.10.1.0/24 with its own SID", "PE2 encapsulates to 2001:db8:100:1:13::", "Each SID is meaningful only at its owner"] },
            { title: "IPv6 VPN", tone: "ip", tag: "End.DT6", points: ["Outer provider IPv6, DA = PE2 End.DT6", "Inner customer IPv6 to 2001:db8:ca:20::a", "Two IPv6 headers, two roles"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="ll-labs" eyebrow="Labs" title="Labs and previews" tone="violet">
        <DiagramFrame caption="SR Policy service steering (preview): the Service SID can follow a transport segment.">
          <PolicyPreviewDiagram />
        </DiagramFrame>
        <p>
          The other read-only labs compare a per-VRF End.DT4 SID with a CE-bound End.DX4 SID, show an RT mismatch that fails at import, and show a route that arrives without an SRv6 L3 Service TLV. Transposition is previewed only.
        </p>
      </GuideSection>

      <GuideSection id="ll-fault" eyebrow="Troubleshooting" title="The broken-service incident" tone="danger">
        <ChecklistCard
          tone="danger"
          title="How to reason about it (no spoilers)"
          mark="→"
          items={[
            "Inspect every layer the incident names, in order: session, received routes, RT import, next hop, Service SID resolution.",
            "Mark each layer healthy or failed only with evidence from the route viewer and FIB.",
            "Pick the fix for the layer that actually failed — not the most familiar knob.",
            "After the fix, resend CE1 → CE3 traffic: a healthy control plane is not proof.",
          ]}
        />
      </GuideSection>

      <GuideSection id="ll-mistakes" eyebrow="Troubleshooting" title="Common mistakes" tone="warning">
        <ChecklistCard
          tone="warning"
          title="Avoid these"
          mark="!"
          items={[
            "Treating the Service SID as the BGP next hop.",
            "Expecting P routers to hold customer routes.",
            "Adding an SRH to a single-SID service packet.",
            "Thinking the RD controls import (the RT does).",
            "Assuming one Service SID per prefix is required.",
            "Treating a received, RT-matched route as automatically usable.",
          ]}
        />
      </GuideSection>

      <GuideSection id="ll-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Service SID", def: "SRv6 SID bound to an egress VPN behavior (here End.DT4/End.DT6)." },
            { term: "Prefix-SID attribute", def: "BGP attribute carrying the SRv6 L3 Service TLV (RFC 9252)." },
            { term: "SRv6 L3 Service TLV", def: "Holds the Service SID and its endpoint behavior." },
            { term: "Infra loopback", def: "PE address used for BGP sessions and next hops." },
            { term: "Locator", def: "Prefix the PE's Service SIDs are built from; must be in remote FIBs." },
            { term: "RD / RT", def: "Make the route unique / decide which VRFs import it." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ll-recap" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="One sentence" icon="✓">
          The VPN machinery stays — VRF, RD, RT and MP-BGP — while the egress instruction becomes an IPv6 Service SID that the core simply routes toward the owning PE&apos;s locator.
        </Callout>
      </GuideSection>
    </>
  );
}
