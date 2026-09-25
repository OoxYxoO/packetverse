import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DRegion, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { ReactNode } from "react";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const VPWS_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "vd-what", label: "What VPWS is" },
  { id: "vd-model", label: "The PWE3 reference model" },
  { id: "vd-ac", label: "Attachment circuit types" },
  { id: "vd-tldp", label: "Targeted vs link LDP" },
  { id: "vd-fec", label: "PW FEC: 128 and 129" },
  { id: "vd-labels", label: "Directional labels & ownership" },
  { id: "vd-stack", label: "Two-label stack" },
  { id: "vd-roles", label: "Ingress, transit, egress" },
  { id: "vd-cw", label: "Control word & sequencing" },
  { id: "vd-mtu", label: "MTU" },
  { id: "vd-status", label: "PW status signaling" },
  { id: "vd-transport", label: "Transport dependency" },
  { id: "vd-trouble", label: "Troubleshooting & verification" },
  { id: "vd-not", label: "What VPWS does NOT do" },
  { id: "vd-glossary", label: "Glossary" },
  { id: "vd-mental", label: "Mental model" },
];

function ReferenceModel() {
  return (
    <DiagramSvg h={190} label="CE, attachment circuit, PE, pseudowire over a PSN tunnel, PE, attachment circuit, CE; the emulated service spans CE to CE">
      <DRegion x={20} y={14} w={600} h={40} label="emulated service (what the customers see: one Ethernet wire)" color={D.success} />
      <DNode x={60} y={110} label="CE" accent={D.ip} w={70} />
      <DNode x={190} y={110} label="PE" accent={D.mpls} w={70} />
      <DNode x={450} y={110} label="PE" accent={D.mpls} w={70} />
      <DNode x={580} y={110} label="CE" accent={D.ip} w={70} />
      <DLink x1={95} y1={110} x2={155} y2={110} color={D.ip} label="AC" labelDy={-8} />
      <DLink x1={485} y1={110} x2={545} y2={110} color={D.ip} label="AC" labelDy={-8} />
      <rect x={225} y={88} width={190} height={44} rx={22} fill={D.mpls} fillOpacity={0.08} stroke={D.mpls} strokeDasharray="5 4" />
      <DLink x1={225} y1={110} x2={415} y2={110} color={D.violet} />
      <text x={320} y={104} textAnchor="middle" fill={D.violet} fontSize={10} fontWeight={700}>
        pseudowire
      </text>
      <text x={320} y={150} textAnchor="middle" fill={D.mpls} fontSize={10}>
        PSN tunnel (MPLS transport LSP)
      </text>
      <text x={320} y={180} textAnchor="middle" fill={D.muted} fontSize={10}>
        RFC 3985 PWE3 architecture: the PW rides inside a tunnel; the tunnel can carry many PWs
      </text>
    </DiagramSvg>
  );
}

function TldpVsLink() {
  return (
    <DiagramSvg h={180} label="Link LDP Hellos go to a multicast address on a directly connected link; targeted LDP Hellos are unicast between non-adjacent loopbacks">
      <text x={20} y={24} fill={D.mpls} fontSize={11} fontWeight={700}>
        Link (basic) discovery
      </text>
      <DNode x={100} y={60} label="R1" accent={D.mpls} w={70} h={34} />
      <DNode x={260} y={60} label="R2" accent={D.mpls} w={70} h={34} />
      <DArrow x1={137} y1={60} x2={223} y2={60} color={D.mpls} both label="224.0.0.2" />
      <text x={20} y={100} fill={D.violet} fontSize={11} fontWeight={700}>
        Extended (targeted) discovery
      </text>
      <DNode x={100} y={150} label="PE1" accent={D.mpls} w={70} h={34} />
      <DNode x={250} y={150} label="P1" accent={D.faint} w={60} h={30} />
      <DNode x={380} y={150} label="P2" accent={D.faint} w={60} h={30} />
      <DNode x={540} y={150} label="PE2" accent={D.mpls} w={70} h={34} />
      <path d="M100 130 Q320 70 540 130" fill="none" stroke={D.violet} strokeWidth={2} strokeDasharray="6 4" />
      <text x={320} y={96} textAnchor="middle" fill={D.violet} fontSize={10} fontWeight={700}>
        unicast Hello to 4.4.4.4 · same UDP/TCP 646
      </text>
    </DiagramSvg>
  );
}

function FecDiagram() {
  const row = (y: number, title: string, c: string, cells: [string, number][]) => {
    let x = 120;
    return (
      <g>
        <text x={16} y={y + 22} fill={c} fontSize={11} fontWeight={700}>
          {title}
        </text>
        {cells.map(([name, w]) => {
          const g = (
            <g key={name}>
              <rect x={x} y={y} width={w - 4} height={34} rx={6} fill={c} fillOpacity={0.12} stroke={c} />
              <text x={x + (w - 4) / 2} y={y + 21} textAnchor="middle" fill={c} fontSize={10} fontWeight={700}>
                {name}
              </text>
            </g>
          );
          x += w;
          return g;
        })}
      </g>
    );
  };
  return (
    <DiagramSvg h={140} label="PWid FEC 128 carries control-word bit, PW type, group ID, PW ID and interface parameters; generalized FEC 129 carries AGI, SAII and TAII">
      {row(18, "FEC 128", D.mpls, [["C bit", 60], ["PW type", 90], ["Group ID", 90], ["PW ID", 90], ["Interface params (MTU…)", 170]])}
      {row(76, "FEC 129", D.violet, [["C bit", 60], ["PW type", 90], ["AGI", 110], ["SAII", 110], ["TAII", 130]])}
    </DiagramSvg>
  );
}

function CwDiagram() {
  return (
    <DiagramSvg h={170} label="Packet with transport label, PW label, optional control word and Ethernet frame; control word starts with 0000, has flags, length and a 16-bit sequence number">
      <DStack x={110} y={20} labels={[{ text: "Transport S0" }, { text: "PW S1", color: D.violet }, { text: "Control word", color: D.warning }]} payload="Ethernet" w={120} />
      <DArrow x1={176} y1={78} x2={222} y2={78} color={D.faint} />
      {[
        ["0000", 50],
        ["flags", 60],
        ["frag", 46],
        ["length", 70],
        ["sequence number (16 bits)", 170],
      ].reduce<{ x: number; els: ReactNode[] }>(
        (acc, [name, w]) => {
          acc.els.push(
            <g key={name as string}>
              <rect x={acc.x} y={60} width={(w as number) - 4} height={36} rx={6} fill={D.warning} fillOpacity={0.12} stroke={D.warning} />
              <text x={acc.x + ((w as number) - 4) / 2} y={82} textAnchor="middle" fill={D.warning} fontSize={10} fontWeight={700}>
                {name as string}
              </text>
            </g>,
          );
          acc.x += w as number;
          return acc;
        },
        { x: 230, els: [] },
      ).els}
      <text x={430} y={124} textAnchor="middle" fill={D.muted} fontSize={10}>
        first nibble 0000 keeps core ECMP from mistaking the payload for IPv4/IPv6
      </text>
    </DiagramSvg>
  );
}

function RolesDiagram() {
  const cols: [number, string, string, string][] = [
    [110, "Ingress PE", "AC lookup, push PW + transport", D.success],
    [320, "Transit P", "swap / PHP-pop outer label only", D.mpls],
    [530, "Egress PE", "PW lookup → pop → AC", D.warning],
  ];
  return (
    <DiagramSvg h={130} label="Ingress PE pushes two labels, transit P swaps or pops the outer label, egress PE looks up and pops the PW label">
      {cols.map(([x, t, d, c], i) => (
        <g key={t}>
          <DNode x={x} y={45} label={t} accent={c} w={150} />
          <text x={x} y={95} textAnchor="middle" fill={D.text} fontSize={10}>
            {d}
          </text>
          {i < 2 && <DArrow x1={x + 78} y1={45} x2={cols[i + 1][0] - 78} y2={45} color={D.faint} />}
        </g>
      ))}
    </DiagramSvg>
  );
}

function StatusDiagram() {
  return (
    <DiagramSvg h={160} label="The AC at PE2 goes down, PE2 signals PW status to PE1, and PE1 marks the service down toward CE1">
      <DNode x={70} y={80} label="CE1" accent={D.ip} w={70} />
      <DNode x={220} y={80} label="PE1" accent={D.mpls} w={80} />
      <DNode x={420} y={80} label="PE2" accent={D.mpls} w={80} />
      <DNode x={570} y={80} label="CE2" accent={D.ip} w={70} />
      <DLink x1={105} y1={80} x2={180} y2={80} color={D.ip} />
      <DLink x1={460} y1={80} x2={535} y2={80} color={D.danger} dashed label="AC down" labelDy={-8} />
      <DArrow x1={378} y1={60} x2={262} y2={60} color={D.danger} label="PW status: AC fault (LDP)" />
      <DLink x1={260} y1={96} x2={380} y2={96} color={D.violet} label="targeted LDP still UP" labelDy={20} />
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        a healthy signaling session does not mean a healthy service
      </text>
    </DiagramSvg>
  );
}

export function VpwsDeepDiveContent() {
  return (
    <>
      <GuideSection id="vd-what" eyebrow="Concept" title="What VPWS is" tone="mpls">
        <p>
          <b className="text-pv-text">Virtual Private Wire Service</b> emulates a point-to-point Layer-2 circuit across a packet network. Whatever enters one attachment circuit leaves the other. There are exactly two endpoints, so there is no MAC learning or flooding decision to make.
        </p>
      </GuideSection>

      <GuideSection id="vd-model" eyebrow="Architecture" title="The PWE3 reference model" tone="mpls">
        <DiagramFrame caption="The customer sees one wire; the provider sees a pseudowire inside a transport tunnel.">
          <ReferenceModel />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vd-ac" eyebrow="Service edge" title="Attachment circuit types" tone="ip">
        <CompareCards
          items={[
            { title: "Port-based", tone: "ip", tag: "whole port", points: ["Every frame on the physical port is carried", "VLAN tags are passed through"] },
            { title: "VLAN-based", tone: "cyan", tag: "sub-interface", points: ["Only one VLAN (e.g. .100) maps to the PW", "Other VLANs can map to other services"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-tldp" eyebrow="Signaling" title="Targeted LDP vs link LDP" tone="violet">
        <DiagramFrame caption="Same protocol, same ports; different discovery. The PEs need not be adjacent.">
          <TldpVsLink />
        </DiagramFrame>
        <p>Discovery (Hellos) and the session (TCP) are separate steps in both cases. Only the operational session carries label mappings.</p>
      </GuideSection>

      <GuideSection id="vd-fec" eyebrow="Signaling" title="PW FEC: 128 and 129" tone="violet">
        <DiagramFrame caption="Both are LDP FEC elements for pseudowires; they identify the PW differently.">
          <FecDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "PWid FEC (128)", tone: "mpls", tag: "used in this lesson", points: ["Both PEs configured with the same PW ID", "Remote PE configured manually", "What this simulation models"] },
            { title: "Generalized PWid FEC (129)", tone: "violet", tag: "named only", points: ["Identifies endpoints with AGI + SAII/TAII", "Suits auto-discovery (e.g. BGP-based)", "Not built in this lesson"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-labels" eyebrow="Labels" title="Directional labels and ownership" tone="mpls">
        <p>
          Pseudowire labels are <b className="text-pv-text">downstream-assigned</b>: each PE allocates the label it wants to receive and advertises it in a Label Mapping. The sender pushes the remote PE&apos;s label. So a PW has two unrelated one-way labels, never one shared value.
        </p>
        <Callout tone="warning" title="Common mistake" icon="!">
          Pushing your own receive label toward the remote PE. The remote PE has no binding for it and drops the traffic.
        </Callout>
      </GuideSection>

      <GuideSection id="vd-stack" eyebrow="Encapsulation" title="Transport label vs service label" tone="mpls">
        <FieldTable
          title="Two labels, two jobs"
          accent="mpls"
          columns={["", "Transport (outer)", "PW / service (inner)"]}
          rows={[
            ["Purpose", "Reach the egress PE", "Select the pseudowire at the egress PE"],
            ["Signaled by", "LDP / RSVP-TE / SR (hop by hop)", "Targeted LDP (PE to PE)"],
            ["Changes in the core?", "Yes: swapped, then PHP-popped", "No: untouched until the egress PE"],
            ["S bit", "0", "1 (bottom of stack)"],
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-roles" eyebrow="Forwarding" title="Ingress, transit and egress behavior" tone="success">
        <DiagramFrame caption="Only the PEs understand the service; P routers are label switches.">
          <RolesDiagram />
        </DiagramFrame>
        <p>With PHP, the penultimate P router removes the transport label, so the egress PE receives only the PW label and does a single lookup.</p>
      </GuideSection>

      <GuideSection id="vd-cw" eyebrow="Encapsulation" title="Control word and sequence numbers" tone="warning">
        <DiagramFrame caption="Optional 4-byte header between the PW label and the payload (RFC 4385).">
          <CwDiagram />
        </DiagramFrame>
        <ChecklistCard
          tone="warning"
          mark="i"
          title="Why use it"
          items={["Prevents P-router ECMP hashing from misreading an Ethernet payload that happens to start with 4 or 6.", "Carries a sequence number so the egress PE can detect out-of-order delivery, if sequencing is enabled.", "Its use is negotiated (the C bit in the FEC); both ends must agree."]}
        />
      </GuideSection>

      <GuideSection id="vd-mtu" eyebrow="Operations" title="MTU" tone="warning">
        <p>
          The customer frame plus labels (plus control word) must fit the core MTU. In LDP-signaled PWs the interface MTU is also exchanged in the FEC&apos;s interface parameters, and many implementations refuse to bring a PW up when the two ends disagree. The lesson&apos;s MTU lab lets you see that as an explicit modeling choice.
        </p>
      </GuideSection>

      <GuideSection id="vd-status" eyebrow="State" title="PW status signaling" tone="danger">
        <DiagramFrame caption="Status is signaled separately from label bindings (via LDP PW status).">
          <StatusDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vd-transport" eyebrow="Dependency" title="Transport dependency" tone="mpls">
        <FlowSteps
          steps={[
            { title: "Needs a tunnel", body: "Every PW rides a transport LSP to the remote PE loopback.", tone: "mpls" },
            { title: "Transport-agnostic", body: "LDP, RSVP-TE or SR-MPLS can provide that LSP; the PW label doesn't change.", tone: "cyan" },
            { title: "Transport failure = service failure", body: "If the LSP to the remote PE breaks, the PW can't forward even with the session up.", tone: "danger" },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-trouble" eyebrow="Operations" title="Troubleshooting and verification" tone="danger">
        <FieldTable
          title="Common pseudowire faults"
          accent="danger"
          columns={["Symptom", "Likely layer", "Check"]}
          rows={[
            ["PW down, targeted LDP down", "Reachability / LDP config", "Loopback reachability, targeted neighbor config"],
            ["PW down, session up", "FEC / parameters", "PW ID, PW type, MTU, control word on both ends"],
            ["PW up, no traffic", "Transport or AC", "LSP to remote loopback, AC state, VLAN"],
            ["One direction only", "Label binding", "Local vs remote label on each PE"],
          ]}
        />
        <FieldTable
          title="Typical verification commands (ideas)"
          accent="cyan"
          columns={["What", "Command idea"]}
          rows={[
            ["PW state and labels", "show l2vpn xconnect detail / show mpls l2transport vc detail"],
            ["Targeted LDP", "show mpls ldp neighbor (targeted)"],
            ["Transport LSP", "show mpls forwarding-table <PE loopback>"],
            ["Data plane", "ping mpls pseudowire / VCCV"],
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-not" eyebrow="Boundaries" title="What VPWS does NOT do" tone="danger">
        <ChecklistCard
          tone="danger"
          mark="✕"
          title="Not VPWS's job"
          items={["Connect more than two sites (that's VPLS or EVPN).", "Learn or look up customer MAC addresses.", "Route customer IP traffic (that's L3VPN).", "Require P routers to hold any service state.", "Use the PW ID as a label."]}
        />
      </GuideSection>

      <GuideSection id="vd-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "PWE3", def: "Pseudowire Emulation Edge-to-Edge: the IETF architecture for pseudowires." },
            { term: "PSN tunnel", def: "The packet-switched-network tunnel (MPLS LSP) carrying PWs." },
            { term: "FEC 128", def: "PWid FEC element: PW type + PW ID (+ group ID, interface parameters)." },
            { term: "FEC 129", def: "Generalized PWid FEC: AGI + attachment individual identifiers." },
            { term: "Control word", def: "Optional 4-byte header after the PW label (ECMP safety, sequencing)." },
            { term: "VCCV", def: "Virtual Circuit Connectivity Verification: PW-level OAM (ping/trace)." },
            { term: "PW status", def: "Signaled indication of AC/PW faults, separate from label bindings." },
            { term: "xconnect", def: "Common CLI term for binding an AC to a pseudowire." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-mental" eyebrow="Recap" title="Mental model" tone="mpls">
        <div className="rounded-2xl border border-pv-mpls/30 bg-gradient-to-br from-pv-mpls/10 to-pv-violet/5 p-5 text-sm leading-relaxed text-pv-text">
          A VPWS is a cable made of labels. The transport tunnel is the conduit, and the pseudowire is the wire inside it, named by a FEC both ends agree on and addressed with labels each receiver hands out. Everything in the core sees only the conduit; only the two PEs know which customer ports the wire connects.
        </div>
      </GuideSection>
    </>
  );
}
