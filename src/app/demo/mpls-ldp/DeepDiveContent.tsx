import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DPill, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const LDP_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "ld-why", label: "Why MPLS exists" },
  { id: "ld-shim", label: "Shim header bit by bit" },
  { id: "ld-stack", label: "Label stacks & the S bit" },
  { id: "ld-ops", label: "PUSH, SWAP, POP" },
  { id: "ld-reserved", label: "Reserved labels" },
  { id: "ld-session", label: "LDP session lifecycle" },
  { id: "ld-modes", label: "Distribution & retention modes" },
  { id: "ld-igp", label: "LDP and the IGP" },
  { id: "ld-null", label: "Implicit vs explicit null" },
  { id: "ld-trouble", label: "Troubleshooting ladder" },
  { id: "ld-glossary", label: "Glossary" },
  { id: "ld-model", label: "Mental model" },
];

function ShimBitsDiagram() {
  const scale = 17.5;
  const fields: [string, number, string][] = [
    ["Label (20)", 20, D.mpls],
    ["TC (3)", 3, D.warning],
    ["S", 1, D.success],
    ["TTL (8)", 8, D.cyan],
  ];
  let x = 40;
  return (
    <DiagramSvg h={110} label="MPLS shim: 20-bit label, 3-bit traffic class, 1-bit bottom of stack, 8-bit TTL">
      {fields.map(([name, bits, c]) => {
        const w = bits * scale;
        const g = (
          <g key={name}>
            <rect x={x} y={30} width={w} height={34} fill={c} fillOpacity={0.16} stroke={c} />
            <text x={x + w / 2} y={52} textAnchor="middle" fill={c} fontSize={bits > 1 ? 11 : 10} fontWeight={700}>
              {name}
            </text>
          </g>
        );
        x += w;
        return g;
      })}
      <text x={40} y={22} fill={D.muted} fontSize={9.5}>
        bit 0
      </text>
      <text x={600} y={22} textAnchor="end" fill={D.muted} fontSize={9.5}>
        bit 31
      </text>
      <text x={320} y={92} textAnchor="middle" fill={D.muted} fontSize={10}>
        4 bytes per label, inserted between the Layer 2 header and the IP header
      </text>
    </DiagramSvg>
  );
}

function StackDiagram() {
  return (
    <DiagramSvg h={170} label="Three example stacks: one label with S=1; two labels with only the bottom S=1; three labels with only the bottom S=1">
      <DStack x={130} y={40} labels={[{ text: "102 S1", tag: "only" }]} caption="one label" />
      <DStack x={330} y={40} labels={[{ text: "102 S0", tag: "outer" }, { text: "24002 S1", tag: "bottom" }]} caption="two labels" />
      <DStack x={530} y={20} labels={[{ text: "1000 S0", tag: "outer" }, { text: "300 S0", tag: "middle" }, { text: "24002 S1", tag: "bottom" }]} caption="three labels" />
    </DiagramSvg>
  );
}

function OpsDiagram() {
  const row = (y: number, op: string, c: string, before: string[], after: string[], note: string) => (
    <g>
      <DPill x={60} y={y + 20} text={op} color={c} w={80} />
      <DStack x={200} y={y} labels={before.map((t) => ({ text: t }))} w={90} />
      <DArrow x1={256} y1={y + 20} x2={330} y2={y + 20} color={c} />
      <DStack x={390} y={y} labels={after.map((t) => ({ text: t }))} w={90} />
      <text x={450} y={y + 24} fill={D.muted} fontSize={10}>
        {note}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={230} label="PUSH adds a label on top, SWAP replaces the top label, POP removes the top label">
      {row(10, "PUSH", D.success, [], ["102 S1"], "new top label")}
      {row(80, "SWAP", D.warning, ["102 S1"], ["203 S1"], "top value changes, S kept")}
      {row(150, "POP", D.danger, ["203 S1"], [], "top removed, rest unchanged")}
    </DiagramSvg>
  );
}

function SessionDiagram() {
  const st: [string, string, string][] = [
    ["NON-EXISTENT", D.faint, "no TCP session"],
    ["INITIALIZED", D.violet, "TCP 646 up"],
    ["OPENSENT", D.violet, "Init sent (active)"],
    ["OPENREC", D.violet, "Init rcvd, KeepAlive sent"],
    ["OPERATIONAL", D.success, "KeepAlive received"],
  ];
  return (
    <DiagramSvg h={130} label="LDP session states: non-existent, initialized, opensent, openrec, operational">
      {st.map(([s, c, note], i) => (
        <g key={s}>
          <DPill x={68 + i * 126} y={40} text={s} color={c} w={112} />
          {i < st.length - 1 && <DArrow x1={125 + i * 126} y1={40} x2={137 + i * 126} y2={40} color={D.faint} width={1.6} />}
          <text x={68 + i * 126} y={72} textAnchor="middle" fill={D.muted} fontSize={9}>
            {note}
          </text>
        </g>
      ))}
      <text x={320} y={110} textAnchor="middle" fill={D.muted} fontSize={10}>
        simplified from RFC 5036 (the passive side skips OPENSENT) · only OPERATIONAL sessions exchange Label Mappings
      </text>
    </DiagramSvg>
  );
}

function RetentionDiagram() {
  return (
    <DiagramSvg h={200} label="R1 hears labels for the same FEC from R2 and R3; the LIB keeps both, the LFIB uses only the IGP next hop's">
      <DNode x={110} y={100} label="R1" sub="LIB: 17 (R2), 25 (R3)" accent={D.mpls} w={150} />
      <DNode x={470} y={45} label="R2" sub="IGP next hop" accent={D.success} w={120} />
      <DNode x={470} y={138} label="R3" sub="not next hop" accent={D.faint} w={120} />
      <DArrow x1={410} y1={52} x2={188} y2={90} color={D.success} label="label 17" labelDy={-6} />
      <DArrow x1={410} y1={132} x2={188} y2={110} color={D.faint} label="label 25" labelDy={16} />
      <DPill x={300} y={186} text="LFIB: out label 17 via R2 · 25 kept for fast failover (liberal retention)" color={D.mpls} w={470} />
    </DiagramSvg>
  );
}

function NullDiagram() {
  return (
    <DiagramSvg h={150} label="Implicit null: the penultimate hop pops. Explicit null: a label 0 stays on so the egress still sees the TC bits">
      <text x={20} y={30} fill={D.mpls} fontSize={10.5} fontWeight={700}>
        implicit-null (3)
      </text>
      <DNode x={200} y={52} label="P" sub="POP" accent={D.mpls} w={80} />
      <DArrow x1={242} y1={52} x2={380} y2={52} color={D.mpls} />
      <DPill x={311} y={34} text="IP" color={D.ip} />
      <DNode x={422} y={52} label="egress PE" accent={D.mpls} w={90} />
      <text x={20} y={100} fill={D.warning} fontSize={10.5} fontWeight={700}>
        explicit-null (0)
      </text>
      <DNode x={200} y={122} label="P" sub="SWAP → 0" accent={D.mpls} w={80} />
      <DArrow x1={242} y1={122} x2={380} y2={122} color={D.warning} />
      <DPill x={311} y={104} text="0 + IP" color={D.warning} />
      <DNode x={422} y={122} label="egress PE" accent={D.mpls} w={90} />
      <text x={475} y={126} fill={D.muted} fontSize={9.5}>
        still sees the TC bits
      </text>
    </DiagramSvg>
  );
}

export function LdpDeepDiveContent() {
  return (
    <>
      <GuideSection id="ld-why" eyebrow="Background" title="Why MPLS exists" tone="mpls">
        <p>
          MPLS separates <b className="text-pv-text">classification</b> (done once, at the ingress edge) from <b className="text-pv-text">forwarding</b> (done by every core router on a short fixed-length label). What that buys a provider is not raw lookup speed but:
        </p>
        <ChecklistCard
          tone="mpls"
          mark="✓"
          title="What labels enable"
          items={["A core that needs no customer or Internet routes (a BGP-free core).", "Services layered on labels: L3VPN, L2VPN, EVPN.", "Traffic engineering: steering paths the IGP wouldn't pick.", "Fast local protection (FRR)."]}
        />
      </GuideSection>

      <GuideSection id="ld-shim" eyebrow="Encoding" title="The shim header, bit by bit" tone="mpls">
        <DiagramFrame caption="Every label costs 4 bytes, which matters for MTU on the core links.">
          <ShimBitsDiagram />
        </DiagramFrame>
        <p>
          The 20-bit label field allows values 0–1,048,575; 0–15 are reserved. The Ethernet frame signals that MPLS follows with EtherType <Mono>0x8847</Mono>.
        </p>
      </GuideSection>

      <GuideSection id="ld-stack" eyebrow="Encoding" title="Label stacks and the S bit" tone="mpls">
        <p>
          A packet can carry several labels. Routers only act on the <b className="text-pv-text">top</b> label. The S (Bottom of Stack) bit is 1 on exactly one label, the bottom one, so a router knows where the labels stop and the payload starts.
        </p>
        <DiagramFrame caption="However deep the stack, only the bottom label has S=1.">
          <StackDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Push and pop leave the rest alone" icon="!">
          PUSH on an empty stack creates the bottom label (S=1). PUSH onto an existing stack adds S=0 on top and keeps the others unchanged. POP removes the top label and leaves the S bits below it unchanged.
        </Callout>
      </GuideSection>

      <GuideSection id="ld-ops" eyebrow="Operations" title="PUSH, SWAP, POP" tone="success">
        <DiagramFrame caption="The three operations every LSR and LER combines.">
          <OpsDiagram />
        </DiagramFrame>
        <p>Real LFIB entries can combine them, such as &quot;swap then push&quot; at a Fast Reroute repair point. The Traffic Engineering lessons show that.</p>
      </GuideSection>

      <GuideSection id="ld-reserved" eyebrow="Reference" title="Reserved label values" tone="cyan">
        <FieldTable
          title="The special ones you will meet"
          accent="cyan"
          columns={["Value", "Name", "Meaning"]}
          rows={[
            [<Mono key="0">0</Mono>, "IPv4 explicit null", "Pop me at the egress, but keep the TC bits until then"],
            [<Mono key="1">1</Mono>, "Router alert", "Punt to the control plane"],
            [<Mono key="2">2</Mono>, "IPv6 explicit null", "As 0, for IPv6 payloads"],
            [<Mono key="3">3</Mono>, "Implicit null", "Signaling only: the upstream hop pops. Never on the wire"],
            [<Mono key="4">16+</Mono>, "Ordinary labels", "Allocated per router for FECs, VPNs, TE LSPs…"],
          ]}
        />
      </GuideSection>

      <GuideSection id="ld-session" eyebrow="LDP" title="LDP session lifecycle" tone="violet">
        <FlowSteps
          steps={[
            { title: "Basic discovery", body: <>Link Hellos to <Mono>224.0.0.2</Mono> on UDP 646 carry the LDP ID (router ID + label space, e.g. <Mono>1.1.1.1:0</Mono>) and a transport address.</>, tone: "mpls" },
            { title: "TCP connection", body: "The side with the higher transport address takes the active role and opens TCP 646.", tone: "violet" },
            { title: "Initialization", body: "Session parameters are proposed and accepted (timers, label distribution mode).", tone: "violet" },
            { title: "Operational", body: "Address, Label Mapping, Withdraw and Release messages flow; KeepAlives keep it up.", tone: "success" },
          ]}
        />
        <DiagramFrame caption="A session that never reaches OPERATIONAL never carries a single label.">
          <SessionDiagram />
        </DiagramFrame>
        <Callout tone="cyan" title="Targeted LDP" icon="i">
          Non-adjacent routers can also form LDP sessions using unicast (targeted) Hellos. They&apos;re used for pseudowires and LDP-over-TE, and appear in the L2VPN lessons.
        </Callout>
      </GuideSection>

      <GuideSection id="ld-modes" eyebrow="LDP" title="Distribution, control and retention modes" tone="violet">
        <CompareCards
          items={[
            { title: "Downstream Unsolicited", tone: "violet", tag: "common default", points: ["Advertise a label for every FEC to every neighbor", "No request needed"] },
            { title: "Downstream on Demand", tone: "cyan", tag: "on request", points: ["Upstream asks for a label", "Used where label space is constrained"] },
          ]}
        />
        <CompareCards
          items={[
            { title: "Liberal retention", tone: "success", tag: "keep all", points: ["Keep bindings from non-next-hop neighbors too", "Faster convergence when the IGP next hop changes"] },
            { title: "Conservative retention", tone: "warning", tag: "keep used", points: ["Keep only the next hop's binding", "Less memory, slower to recover"] },
          ]}
        />
        <DiagramFrame caption="Why the LIB can hold more than the LFIB (hypothetical labels).">
          <RetentionDiagram />
        </DiagramFrame>
        <p>
          <b className="text-pv-text">Independent vs ordered control:</b> with independent control a router advertises a label as soon as it knows the FEC. With ordered control it waits until it has a label from its own next hop (or is the egress).
        </p>
      </GuideSection>

      <GuideSection id="ld-igp" eyebrow="Dependencies" title="LDP rides on the IGP" tone="ospf">
        <ChecklistCard
          tone="ospf"
          mark="↳"
          title="Consequences of that dependency"
          items={[
            "No IGP route for the FEC means no usable LFIB entry, even if a binding exists in the LIB.",
            "If the IGP comes up before LDP on a link, traffic can be sent there unlabeled and blackholed. LDP–IGP synchronization delays the IGP until LDP is ready.",
            "LDP session protection keeps bindings from a neighbor while the link flaps, for faster recovery.",
          ]}
        />
      </GuideSection>

      <GuideSection id="ld-null" eyebrow="Egress" title="Implicit null vs explicit null" tone="mpls">
        <DiagramFrame caption="Explicit null trades one extra egress lookup for end-to-end QoS marking.">
          <NullDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ld-trouble" eyebrow="Operations" title="Troubleshooting ladder" tone="danger">
        <FieldTable
          title="Work up the layers; stop at the first one that fails"
          accent="danger"
          columns={["Layer", "Check", "Typical command idea"]}
          rows={[
            ["1. Interface", "Up/up, MPLS enabled on it", "show mpls interfaces"],
            ["2. IGP", "Route to the FEC, adjacency FULL", "show ip route 4.4.4.4"],
            ["3. LDP discovery", "Hellos seen on the link", "show mpls ldp discovery"],
            ["4. LDP session", "Neighbor OPERATIONAL", "show mpls ldp neighbor"],
            ["5. LIB", "Binding from the IGP next hop", "show mpls ldp bindings"],
            ["6. LFIB", "In → action → out entry", "show mpls forwarding-table"],
            ["7. Data plane", "Label stack on the wire", "traceroute / ping mpls"],
          ]}
        />
        <Callout tone="warning" title="The classic symptom" icon="!">
          &quot;IP works, MPLS doesn&apos;t&quot; almost always sits between layers 3 and 6. The IGP is fine, so the fault is in how labels were (or weren&apos;t) exchanged.
        </Callout>
      </GuideSection>

      <GuideSection id="ld-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Label space", def: "The :0 in an LDP ID: platform-wide labels shared across interfaces." },
            { term: "Transport address", def: "The address LDP uses for its TCP session, often the loopback." },
            { term: "Label Mapping", def: "LDP message binding a label to a FEC." },
            { term: "Label Withdraw", def: "LDP message removing a previously advertised binding." },
            { term: "Ordered control", def: "Advertise only once your own downstream label is known." },
            { term: "Liberal retention", def: "Keep bindings from all neighbors, used or not." },
            { term: "Explicit null", def: "Label 0 (IPv4) / 2 (IPv6): stays on until the egress, preserving TC." },
            { term: "EtherType 0x8847", def: "MPLS unicast payload inside an Ethernet frame." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ld-model" eyebrow="Recap" title="Mental model" tone="mpls">
        <div className="rounded-2xl border border-pv-mpls/30 bg-gradient-to-br from-pv-mpls/10 to-pv-violet/5 p-5 text-sm leading-relaxed text-pv-text">
          The IGP finds reachability. LDP turns every reachable FEC into a chain of local labels, one per link, advertised upstream. The LFIB is that chain, installed. The data plane only ever touches the top label, and the S bit marks where the stack ends. When something breaks, ask which of those three pieces is missing on which link.
        </div>
      </GuideSection>
    </>
  );
}
