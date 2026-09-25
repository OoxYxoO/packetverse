import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DPill, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const BGP_VPLS_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "bd-arch", label: "RFC 4761 at a glance" },
  { id: "bd-nlri", label: "The VPLS NLRI on the wire" },
  { id: "bd-ext", label: "RT and Layer2 Info" },
  { id: "bd-ve", label: "VE, VE ID and blocks" },
  { id: "bd-math", label: "Label computation" },
  { id: "bd-multi", label: "Multiple label blocks" },
  { id: "bd-rr", label: "Route reflectors" },
  { id: "bd-seq", label: "Discovery to PW setup" },
  { id: "bd-withdraw", label: "Withdrawal and failure" },
  { id: "bd-compare", label: "LDP-VPLS vs BGP-VPLS vs EVPN" },
  { id: "bd-variant", label: "BGP-AD + LDP signaling" },
  { id: "bd-trouble", label: "Faults and verification" },
  { id: "bd-not", label: "What BGP-VPLS does NOT do" },
  { id: "bd-glossary", label: "Glossary" },
  { id: "bd-mental", label: "Mental model" },
];

function ArchDiagram() {
  return (
    <DiagramSvg h={216} label="PEs run VSIs; BGP through a route reflector distributes VPLS NLRI; pseudowires form automatically between members">
      <DNode x={320} y={36} label="RR" sub="MP-BGP L2VPN/VPLS" accent={D.bgp} w={150} />
      {[110, 320, 530].map((x, i) => (
        <g key={x}>
          <DArrow x1={x} y1={128} x2={320 + (x - 320) * 0.3} y2={62} color={D.bgp} both />
          <DNode x={x} y={150} label={`PE${i + 1}`} sub="VSI" accent={D.mpls} w={100} />
        </g>
      ))}
      <path d="M160 170 Q320 210 480 170" fill="none" stroke={D.violet} strokeWidth={2} strokeDasharray="5 4" />
      <text x={320} y={208} textAnchor="middle" fill={D.violet} fontSize={10} fontWeight={700}>
        pseudowires derived from the NLRI (data plane)
      </text>
    </DiagramSvg>
  );
}

function NlriBytes() {
  const cells: [string, string, number, string][] = [
    ["Length", "2 B", 60, D.faint],
    ["RD", "8 B", 140, D.bgp],
    ["VE ID", "2 B", 80, D.violet],
    ["VE Block Offset", "2 B", 110, D.mpls],
    ["VE Block Size", "2 B", 100, D.mpls],
    ["Label Base", "3 B", 100, D.mpls],
  ];
  let x = 20;
  return (
    <DiagramSvg h={110} label="VPLS NLRI: length 2 bytes, RD 8, VE ID 2, VE block offset 2, VE block size 2, label base 3">
      {cells.map(([n, b, w, c]) => {
        const g = (
          <g key={n}>
            <rect x={x} y={20} width={w - 4} height={46} rx={6} fill={c} fillOpacity={0.14} stroke={c} />
            <text x={x + (w - 4) / 2} y={40} textAnchor="middle" fill={c} fontSize={10} fontWeight={700}>
              {n}
            </text>
            <text x={x + (w - 4) / 2} y={57} textAnchor="middle" fill={D.muted} fontSize={9.5}>
              {b}
            </text>
          </g>
        );
        x += w;
        return g;
      })}
      <text x={320} y={96} textAnchor="middle" fill={D.muted} fontSize={10}>
        AFI 25 (L2VPN) / SAFI 65 (VPLS) · the label base is a 20-bit label in a 3-byte field
      </text>
    </DiagramSvg>
  );
}

function MultiBlock() {
  return (
    <DiagramSvg h={170} label="A PE can advertise a second block with VBO 5 to cover VE IDs 5 to 8; a sender with VE ID 7 uses the second block">
      <text x={20} y={30} fill={D.mpls} fontSize={10.5} fontWeight={700}>
        block A: VBO 1, VBS 4, LB 24000
      </text>
      {[1, 2, 3, 4].map((ve, i) => (
        <g key={ve}>
          <rect x={240 + i * 90} y={14} width={84} height={26} rx={6} fill={D.mpls} fillOpacity={0.1} stroke={D.mpls} />
          <text x={282 + i * 90} y={31} textAnchor="middle" fill={D.text} fontSize={9.5}>
            VE {ve} → {24000 + ve - 1}
          </text>
        </g>
      ))}
      <text x={20} y={80} fill={D.warning} fontSize={10.5} fontWeight={700}>
        block B: VBO 5, VBS 4, LB 24100
      </text>
      {[5, 6, 7, 8].map((ve, i) => (
        <g key={ve}>
          <rect x={240 + i * 90} y={64} width={84} height={26} rx={6} fill={ve === 7 ? D.success : D.warning} fillOpacity={ve === 7 ? 0.25 : 0.1} stroke={ve === 7 ? D.success : D.warning} />
          <text x={282 + i * 90} y={81} textAnchor="middle" fill={D.text} fontSize={9.5}>
            VE {ve} → {24100 + ve - 5}
          </text>
        </g>
      ))}
      <text x={320} y={130} textAnchor="middle" fill={D.text} fontSize={10.5}>
        hypothetical second block · VE 7 → 24100 + 7 − 5 = 24102
      </text>
      <text x={320} y={152} textAnchor="middle" fill={D.muted} fontSize={10}>
        this lesson instead widens one block (VBS 4 → 8, same base), which is equivalent
      </text>
    </DiagramSvg>
  );
}

function SequenceDiagram() {
  const st: [string, string][] = [
    ["configure", D.violet],
    ["UPDATE → RR", D.bgp],
    ["reflect to clients", D.bgp],
    ["RT import", D.warning],
    ["compute label", D.mpls],
    ["PW up both ways", D.success],
  ];
  return (
    <DiagramSvg h={100} label="Configure, advertise, reflect, import, compute label, pseudowire up">
      {st.map(([s, c], i) => (
        <g key={s}>
          <DPill x={54 + i * 106} y={40} text={s} color={c} w={100} />
          {i < st.length - 1 && <DArrow x1={104 + i * 106} y1={40} x2={110 + i * 106} y2={40} color={D.faint} width={1.4} />}
        </g>
      ))}
      <text x={54} y={66} textAnchor="middle" fill={D.muted} fontSize={9}>
        RD · RT · VE · block
      </text>
      <text x={320} y={90} textAnchor="middle" fill={D.muted} fontSize={10}>
        no per-pair session and no separate label exchange: discovery and signaling are the same message
      </text>
    </DiagramSvg>
  );
}

function MacPlaneDiagram() {
  const row = (y: number, name: string, c: string, learn: string, ctrl: string) => (
    <g>
      <text x={20} y={y + 5} fill={c} fontSize={11} fontWeight={700}>
        {name}
      </text>
      <DPill x={270} y={y} text={ctrl} color={D.bgp} w={220} />
      <DPill x={510} y={y} text={learn} color={D.success} w={200} />
    </g>
  );
  return (
    <DiagramSvg h={170} label="LDP-VPLS: LDP signals PWs, MACs learned in data plane. BGP-VPLS: BGP signals PWs, MACs learned in data plane. EVPN: BGP carries MAC/IP routes">
      <text x={270} y={20} textAnchor="middle" fill={D.muted} fontSize={10} fontWeight={700}>
        what the control plane carries
      </text>
      <text x={510} y={20} textAnchor="middle" fill={D.muted} fontSize={10} fontWeight={700}>
        where remote MACs come from
      </text>
      {row(50, "LDP-VPLS", D.violet, "data plane (flood & learn)", "targeted LDP: PW labels")}
      {row(95, "BGP-VPLS", D.bgp, "data plane (flood & learn)", "BGP: membership + label blocks")}
      {row(140, "EVPN", D.success, "control plane (Type 2 routes)", "BGP: MAC/IP + more")}
    </DiagramSvg>
  );
}

function WithdrawDiagram() {
  return (
    <DiagramSvg h={150} label="PE3 sends a withdraw; RR reflects it; PE1 and PE2 remove PE3's membership and PWs while PE1 to PE2 keeps working">
      <DNode x={90} y={70} label="PE3" accent={D.danger} w={80} />
      <DNode x={300} y={70} label="RR" accent={D.bgp} w={70} />
      <DNode x={520} y={35} label="PE1" accent={D.mpls} w={80} />
      <DNode x={520} y={110} label="PE2" accent={D.mpls} w={80} />
      <DArrow x1={132} y1={70} x2={262} y2={70} color={D.danger} label="WITHDRAW" />
      <DArrow x1={337} y1={62} x2={478} y2={38} color={D.danger} />
      <DArrow x1={337} y1={78} x2={478} y2={106} color={D.danger} />
      <text x={600} y={78} textAnchor="end" fill={D.success} fontSize={9.5}>
        PE1 ↔ PE2 unaffected
      </text>
      <text x={320} y={142} textAnchor="middle" fill={D.muted} fontSize={10}>
        membership and PW state follow the BGP route: no route, no PW
      </text>
    </DiagramSvg>
  );
}

export function BgpVplsDeepDiveContent() {
  return (
    <>
      <GuideSection id="bd-arch" eyebrow="Architecture" title="RFC 4761 at a glance" tone="bgp">
        <p>
          RFC 4761 uses BGP for both <b className="text-pv-text">auto-discovery</b> (which PEs are in a VPLS) and <b className="text-pv-text">signaling</b> (which labels to use). The VPLS forwarding behavior is the same as with LDP signaling.
        </p>
        <DiagramFrame caption="Control through BGP; pseudowires and bridging exactly as before.">
          <ArchDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bd-nlri" eyebrow="Encoding" title="The VPLS NLRI on the wire" tone="bgp">
        <DiagramFrame caption="One NLRI = one PE's identity plus one label block.">
          <NlriBytes />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bd-ext" eyebrow="Encoding" title="Route Target and Layer2 Info" tone="violet">
        <FieldTable
          title="Extended communities attached to the NLRI"
          accent="violet"
          columns={["Community", "Carries", "Used for"]}
          rows={[
            ["Route Target", "e.g. 65000:100", "Membership: import only matching VPLS routes"],
            ["Layer2 Info", "Encaps type (VPLS), control flags, MTU", "Compatibility checks (MTU must match)"],
          ]}
        />
        <Callout tone="cyan" title="Control flags" icon="i">
          The Layer2 Info control flags (control word, sequencing) were later clarified by RFC 8614. This lesson shows them for information only.
        </Callout>
      </GuideSection>

      <GuideSection id="bd-ve" eyebrow="Concepts" title="VE, VE ID and label blocks" tone="violet">
        <p>
          A <b className="text-pv-text">VE</b> (VPLS Edge) is a PE&apos;s presence in one VPLS; the <b className="text-pv-text">VE ID</b> numbers it uniquely within that VPLS. A PE advertises a block of labels so that each remote VE can pick its own receive label without a per-pair exchange.
        </p>
      </GuideSection>

      <GuideSection id="bd-math" eyebrow="Concepts" title="Label computation" tone="mpls">
        <FlowSteps
          steps={[
            { title: "Receiver advertises", body: "Label Base LB, offset VBO, size VBS.", tone: "mpls" },
            { title: "Sender checks coverage", body: "Its own VE ID V must satisfy VBO ≤ V < VBO + VBS.", tone: "warning" },
            { title: "Sender computes", body: <>label = LB + V − VBO, and pushes it as the inner PW label toward that receiver.</>, tone: "success" },
            { title: "Receiver demultiplexes", body: "The same slot tells the receiver which VSI, and which remote VE, the frame came from.", tone: "violet" },
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-multi" eyebrow="Concepts" title="Multiple label blocks" tone="warning">
        <DiagramFrame caption="VE IDs outside every advertised block get no label, so the PW can't come up.">
          <MultiBlock />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bd-rr" eyebrow="Scaling" title="Route reflectors" tone="bgp">
        <p>
          Without an RR, PEs need a full iBGP mesh, which is the same n² problem in the control plane. With RRs each PE has one or two sessions. The RR relays VPLS NLRI and applies ordinary reflection rules; it never forwards customer frames and needs no VSI. RT Constraint can further limit which VPLS routes a PE receives.
        </p>
      </GuideSection>

      <GuideSection id="bd-seq" eyebrow="Flow" title="From discovery to pseudowire" tone="success">
        <DiagramFrame caption="Membership and labels travel in the same UPDATE.">
          <SequenceDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bd-withdraw" eyebrow="Failure" title="Withdrawal and failure" tone="danger">
        <DiagramFrame caption="Leaving the VPLS is one BGP message.">
          <WithdrawDiagram />
        </DiagramFrame>
        <p>A BGP session failure to the RR withdraws everything learned over it, so a single-RR design needs redundancy. Customer MAC entries learned on removed PWs are flushed locally.</p>
      </GuideSection>

      <GuideSection id="bd-compare" eyebrow="Comparison" title="LDP-VPLS vs BGP-VPLS vs EVPN" tone="violet">
        <DiagramFrame caption="The key question: where does a PE learn remote customer MACs?">
          <MacPlaneDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "LDP-VPLS → BGP-VPLS", tone: "bgp", tag: "changes", points: ["Discovery: manual → BGP auto-discovery", "Signaling: per-pair targeted LDP → label blocks", "Data plane: unchanged"] },
            { title: "BGP-VPLS → EVPN", tone: "success", tag: "changes", points: ["Customer MAC/IP in BGP (Type 2)", "Native multihoming (ESI, DF)", "Different NLRI and address family"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-variant" eyebrow="Variant" title="BGP auto-discovery with LDP signaling" tone="cyan">
        <p>
          A different standard combination also exists: BGP only for <i>discovery</i>, then LDP with the generalized PWid FEC (FEC 129) for <i>signaling</i> (RFC 6074). It&apos;s mentioned for completeness; this lesson models pure RFC 4761 BGP signaling.
        </p>
      </GuideSection>

      <GuideSection id="bd-trouble" eyebrow="Operations" title="Faults and verification" tone="danger">
        <FieldTable
          title="Common BGP-VPLS faults"
          accent="danger"
          columns={["Symptom", "Likely cause"]}
          rows={[
            ["Session up, no VPLS routes", "L2VPN/VPLS address family not enabled"],
            ["Route received, member not discovered", "RT import mismatch"],
            ["Member discovered, PW down one way", "VE ID outside the remote block"],
            ["Two PEs fight over a site", "Duplicate VE ID in the same VPLS"],
            ["PW down, MTU logged", "Layer2 Info MTU mismatch"],
          ]}
        />
        <FieldTable
          title="Verification ideas"
          accent="cyan"
          columns={["What", "Command idea"]}
          rows={[
            ["Sessions / AF", "show bgp l2vpn vpls summary"],
            ["Received routes", "show bgp l2vpn vpls (per RD)"],
            ["Label blocks and PWs", "show vpls connections / show l2vpn vfi"],
            ["MAC table", "show vpls mac-table"],
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-not" eyebrow="Boundaries" title="What BGP-VPLS does NOT do" tone="danger">
        <ChecklistCard
          tone="danger"
          mark="✕"
          title="Not in BGP-VPLS"
          items={["Advertise customer MAC addresses (that's EVPN Type 2).", "Remove flood-and-learn or unknown-unicast flooding.", "Change split horizon or the two-label data plane.", "Put the RR in the data path.", "Provide native all-active multihoming."]}
        />
      </GuideSection>

      <GuideSection id="bd-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "RFC 4761", def: "VPLS using BGP for auto-discovery and signaling." },
            { term: "RFC 6074", def: "BGP auto-discovery with LDP (FEC 129) signaling." },
            { term: "VE", def: "VPLS Edge: a PE's membership in a VPLS." },
            { term: "Label block", def: "LB + VBO + VBS: a range of receive labels." },
            { term: "Layer2 Info", def: "Extended community with encapsulation, flags and MTU." },
            { term: "RT Constraint", def: "Lets RRs send only routes a PE imports." },
            { term: "Demultiplexor", def: "The inner label identifying VSI + remote VE." },
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-mental" eyebrow="Recap" title="Mental model" tone="bgp">
        <div className="rounded-2xl border border-pv-bgp/30 bg-gradient-to-br from-pv-bgp/10 to-pv-violet/5 p-5 text-sm leading-relaxed text-pv-text">
          BGP-VPLS turns the pseudowire mesh into something PEs announce rather than configure. The NLRI says who is in the VPLS and hands out a block of labels; arithmetic picks each sender&apos;s label. Everything that happens to customer frames afterwards is plain VPLS, flood-and-learn included.
        </div>
      </GuideSection>
    </>
  );
}
