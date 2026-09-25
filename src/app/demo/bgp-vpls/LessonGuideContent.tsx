import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const BGP_VPLS_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "bl-mission", label: "The mission" },
  { id: "bl-why", label: "Why not targeted LDP?" },
  { id: "bl-topology", label: "Two topologies" },
  { id: "bl-session", label: "MP-BGP and the L2VPN/VPLS AF" },
  { id: "bl-ids", label: "RD, RT and VE ID" },
  { id: "bl-block", label: "The label block" },
  { id: "bl-nlri", label: "Anatomy of the VPLS NLRI" },
  { id: "bl-discovery", label: "Auto-discovery via RR1" },
  { id: "bl-math", label: "Deriving PW labels" },
  { id: "bl-mesh", label: "Six labels, PW mesh UP" },
  { id: "bl-nomacs", label: "What is NOT in BGP" },
  { id: "bl-data", label: "Same data plane as LDP-VPLS" },
  { id: "bl-known", label: "Known unicast" },
  { id: "bl-block-edge", label: "Outside the block (VE 7)" },
  { id: "bl-withdraw", label: "Withdrawal and rejoin" },
  { id: "bl-planes", label: "Control vs data plane" },
  { id: "bl-fault", label: "The CE3 membership incident" },
  { id: "bl-challenge", label: "The engineer challenge" },
  { id: "bl-glossary", label: "Glossary" },
  { id: "bl-recap", label: "Mental model" },
];

function TwoTopologies() {
  return (
    <DiagramSvg h={220} label="Control plane: PE1, PE2, PE3 peer only with RR1. Service plane: PE1, PE2, PE3 fully meshed with pseudowires">
      <text x={160} y={20} textAnchor="middle" fill={D.bgp} fontSize={11} fontWeight={700}>
        control plane: hub and spoke
      </text>
      <DNode x={160} y={110} label="RR1" sub="route reflector" accent={D.bgp} w={90} />
      {[
        ["PE1", 50, 50],
        ["PE2", 50, 180],
        ["PE3", 270, 180],
      ].map(([id, x, y]) => (
        <g key={id as string}>
          <DLink x1={x as number} y1={y as number} x2={160} y2={110} color={D.bgp} />
          <DNode x={x as number} y={y as number} label={id as string} accent={D.mpls} w={60} h={32} />
        </g>
      ))}
      <text x={480} y={20} textAnchor="middle" fill={D.violet} fontSize={11} fontWeight={700}>
        service plane: full PW mesh
      </text>
      <DLink x1={390} y1={60} x2={570} y2={60} color={D.violet} />
      <DLink x1={390} y1={60} x2={480} y2={180} color={D.violet} />
      <DLink x1={570} y1={60} x2={480} y2={180} color={D.violet} />
      <DNode x={390} y={60} label="PE1" accent={D.mpls} w={60} h={32} />
      <DNode x={570} y={60} label="PE2" accent={D.mpls} w={60} h={32} />
      <DNode x={480} y={180} label="PE3" accent={D.mpls} w={60} h={32} />
      <text x={480} y={212} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        customer frames never pass through RR1
      </text>
    </DiagramSvg>
  );
}

function NlriDiagram() {
  const cells: [string, string, number, string][] = [
    ["RD", "65000:1", 80, D.bgp],
    ["VE ID", "1", 60, D.violet],
    ["VBO", "1", 55, D.mpls],
    ["VBS", "4", 55, D.mpls],
    ["Label Base", "24000", 90, D.mpls],
    ["RT", "65000:100", 95, D.violet],
    ["Next hop", "1.1.1.1", 80, D.ospf],
    ["L2 Info", "VPLS, MTU 1500", 100, D.cyan],
  ];
  let x = 12;
  return (
    <DiagramSvg h={110} label="PE1's VPLS NLRI: RD 65000:1, VE ID 1, VBO 1, VBS 4, Label Base 24000, RT 65000:100, next hop 1.1.1.1, Layer2 Info VPLS MTU 1500">
      {cells.map(([n, v, w, c]) => {
        const g = (
          <g key={n}>
            <rect x={x} y={20} width={w - 4} height={50} rx={6} fill={c} fillOpacity={0.12} stroke={c} />
            <text x={x + (w - 4) / 2} y={40} textAnchor="middle" fill={c} fontSize={9.5} fontWeight={700}>
              {n}
            </text>
            <text x={x + (w - 4) / 2} y={58} textAnchor="middle" fill={D.text} fontSize={9.5} fontFamily="monospace">
              {v}
            </text>
          </g>
        );
        x += w;
        return g;
      })}
      <text x={320} y={98} textAnchor="middle" fill={D.muted} fontSize={10}>
        PE1&apos;s advertisement (AFI 25 / SAFI 65) · nothing in it names a customer MAC
      </text>
    </DiagramSvg>
  );
}

function DiscoveryDiagram() {
  const st: [string, string, string][] = [
    ["ADVERTISE", D.bgp, "PE1 → RR1"],
    ["REFLECT", D.bgp, "RR1 → PE2, PE3"],
    ["RECEIVE", D.violet, "Adj-RIB-In"],
    ["RT IMPORT CHECK", D.warning, "RT matches?"],
    ["DISCOVERED", D.success, "remote VE known"],
  ];
  return (
    <DiagramSvg h={120} label="Advertise from PE1 to RR1, reflect to PE2 and PE3, receive, RT import check, discovered">
      {st.map(([s, c, sub], i) => (
        <g key={s}>
          <DPill x={66 + i * 127} y={40} text={s} color={c} w={118} />
          <text x={66 + i * 127} y={68} textAnchor="middle" fill={D.muted} fontSize={9.5}>
            {sub}
          </text>
          {i < st.length - 1 && <DArrow x1={126 + i * 127} y1={40} x2={134 + i * 127} y2={40} color={D.faint} width={1.4} />}
        </g>
      ))}
      <text x={320} y={104} textAnchor="middle" fill={D.muted} fontSize={10}>
        received and imported are different states: the RT decides
      </text>
    </DiagramSvg>
  );
}

function BlockMath() {
  return (
    <DiagramSvg h={200} label="PE2's block VBO 1 VBS 4 base 25000 covers VE 1 to 4 with labels 25000 to 25003; PE1 with VE 1 uses 25000 to send to PE2">
      <text x={320} y={20} textAnchor="middle" fill={D.mpls} fontSize={11} fontWeight={700}>
        PE2 advertises: VBO 1 · VBS 4 · Label Base 25000
      </text>
      {[1, 2, 3, 4].map((ve, i) => (
        <g key={ve}>
          <rect x={120 + i * 105} y={40} width={95} height={50} rx={8} fill={ve === 1 ? D.success : D.mpls} fillOpacity={ve === 1 ? 0.2 : 0.08} stroke={ve === 1 ? D.success : D.mpls} />
          <text x={167 + i * 105} y={60} textAnchor="middle" fill={D.muted} fontSize={9.5}>
            sender VE {ve}
          </text>
          <text x={167 + i * 105} y={79} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700} fontFamily="monospace">
            {25000 + ve - 1}
          </text>
        </g>
      ))}
      <DArrow x1={167} y1={135} x2={167} y2={96} color={D.success} />
      <DNode x={167} y={155} label="PE1 (VE 1)" accent={D.success} w={110} h={34} />
      <text x={400} y={150} fill={D.text} fontSize={10.5}>
        label = 25000 + 1 − 1 = <tspan fontWeight={700} fill={D.success}>25000</tspan>
      </text>
      <text x={400} y={170} fill={D.muted} fontSize={10}>
        the receiver owns the block; the sender picks its slot
      </text>
    </DiagramSvg>
  );
}

function StackDiagram() {
  return (
    <DiagramSvg h={150} label="Forward copy PE1 to PE2 carries transport 102 over 25000; reply PE2 to PE1 carries transport 201 over 24001">
      <text x={180} y={20} textAnchor="middle" fill={D.warning} fontSize={10.5} fontWeight={700}>
        CE1 → CE2 copy (PE1 → PE2)
      </text>
      <DStack x={180} y={32} labels={[{ text: "102 S0", tag: "OUTER" }, { text: "25000 S1", tag: "INNER", color: D.violet }]} payload="Ethernet" w={90} />
      <text x={460} y={20} textAnchor="middle" fill={D.success} fontSize={10.5} fontWeight={700}>
        CE2 → CE1 known unicast (PE2 → PE1)
      </text>
      <DStack x={460} y={32} labels={[{ text: "201 S0", tag: "OUTER" }, { text: "24001 S1", tag: "INNER", color: D.violet }]} payload="Ethernet" w={90} />
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        inner labels are BGP-derived; the stack shape is identical to LDP-VPLS
      </text>
    </DiagramSvg>
  );
}

function RtFaultDiagram() {
  return (
    <DiagramSvg h={170} label="RR1 reflects PE3's NLRI to PE1 and PE2, which receive it but do not import it because the RT does not match">
      <DNode x={320} y={40} label="RR1" accent={D.bgp} w={80} />
      <DNode x={110} y={130} label="PE1" sub="import 65000:100" accent={D.mpls} w={130} />
      <DNode x={320} y={130} label="PE2" sub="import 65000:100" accent={D.mpls} w={130} />
      <DNode x={530} y={130} label="PE3" sub="Established" accent={D.danger} w={130} />
      <DArrow x1={490} y1={110} x2={360} y2={55} color={D.bgp} />
      <DArrow x1={280} y1={55} x2={150} y2={110} color={D.bgp} />
      <text x={440} y={70} fill={D.bgp} fontSize={10} fontWeight={700}>
        NLRI + RT ?
      </text>
      <text x={200} y={70} textAnchor="end" fill={D.bgp} fontSize={10} fontWeight={700}>
        reflected
      </text>
      <DArrow x1={320} y1={62} x2={320} y2={106} color={D.bgp} />
      <text x={320} y={166} textAnchor="middle" fill={D.danger} fontSize={10.5} fontWeight={700}>
        RECEIVED ≠ IMPORTED
      </text>
    </DiagramSvg>
  );
}

export function BgpVplsLessonGuideContent() {
  return (
    <>
      <GuideSection id="bl-mission" eyebrow="Introduction" title="The mission: signal the virtual LAN with BGP" tone="bgp">
        <p>
          Same customer, same three sites, same physical network as the LDP-VPLS lesson. What changes is how the service is <b className="text-pv-text">discovered and signaled</b>: MP-BGP through route reflector <Mono>RR1</Mono> (AS 65000) replaces the targeted-LDP mesh, following RFC 4761.
        </p>
        <Callout tone="warning" title="This is NOT EVPN" icon="!">
          BGP here carries membership and label-block signaling only. Customer MAC addresses are still learned from the Ethernet data plane.
        </Callout>
      </GuideSection>

      <GuideSection id="bl-why" eyebrow="Motivation" title="Why not targeted LDP?" tone="cyan">
        <p>With targeted LDP every PE is configured with every other PE and runs a session per pair. Adding a PE means touching all the others. BGP auto-discovery lets a new PE announce itself once and be found by every member.</p>
      </GuideSection>

      <GuideSection id="bl-topology" eyebrow="Setup" title="Two topologies" tone="bgp">
        <DiagramFrame caption="RR1 exists only in the control plane.">
          <TwoTopologies />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bl-session" eyebrow="Control plane" title="MP-BGP and the L2VPN/VPLS address family" tone="bgp">
        <FlowSteps
          steps={[
            { title: "Transport", body: "IGP + LDP transport LSPs between all PE loopbacks, unchanged.", tone: "mpls" },
            { title: "Sessions", body: "PE1, PE2, PE3 → RR1 reach Established. Nothing VPLS-specific yet.", tone: "bgp" },
            { title: "Address family", body: <>AFI <Mono>25</Mono> (L2VPN) / SAFI <Mono>65</Mono> (VPLS) enabled on every session.</>, tone: "violet" },
          ]}
        />
      </GuideSection>

      <GuideSection id="bl-ids" eyebrow="Identifiers" title="RD, RT and VE ID" tone="violet">
        <FieldTable
          title="Per-PE identity in this lesson"
          accent="violet"
          columns={["PE", "RD", "RT (import/export)", "VE ID"]}
          rows={[
            ["PE1", <Mono key="1">65000:1</Mono>, <Mono key="2">65000:100</Mono>, "1"],
            ["PE2", <Mono key="3">65000:2</Mono>, <Mono key="4">65000:100</Mono>, "2"],
            ["PE3", <Mono key="5">65000:3</Mono>, <Mono key="6">65000:100</Mono>, "3"],
          ]}
        />
        <p>RD makes each advertisement unique; RT decides membership (import); VE ID is a per-VPLS site identifier, not a router ID, loopback, VLAN or label.</p>
      </GuideSection>

      <GuideSection id="bl-block" eyebrow="Signaling" title="The label block" tone="mpls">
        <p>
          Instead of one label per peer, a PE advertises a <b className="text-pv-text">block</b>: VE Block Offset (VBO), VE Block Size (VBS) and Label Base (LB). Every PE here advertises VBO 1, VBS 4, covering remote VE IDs 1–4, with its own base: PE1 <Mono>24000</Mono>, PE2 <Mono>25000</Mono>, PE3 <Mono>26000</Mono>.
        </p>
      </GuideSection>

      <GuideSection id="bl-nlri" eyebrow="Signaling" title="Anatomy of the VPLS NLRI" tone="bgp">
        <DiagramFrame caption="One UPDATE carries membership (RT), identity (RD, VE ID) and signaling (label block).">
          <NlriDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bl-discovery" eyebrow="Control plane" title="Auto-discovery via RR1" tone="bgp">
        <DiagramFrame caption="RR1 reflects client-to-client, exactly as in the Route Reflector lesson.">
          <DiscoveryDiagram />
        </DiagramFrame>
        <p>PE1 advertises; RR1 reflects to PE2 and PE3; each checks the RT against its import RT and, on a match, discovers PE1 as a CUST-A-VPLS member. PE2 and PE3 do the same in turn.</p>
      </GuideSection>

      <GuideSection id="bl-math" eyebrow="Signaling" title="Deriving PW labels from a block" tone="mpls">
        <DiagramFrame caption="Label = receiver's Label Base + sender's VE ID − VBO.">
          <BlockMath />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bl-mesh" eyebrow="State" title="Six labels, PW mesh UP" tone="success">
        <FieldTable
          title="Derived labels (sender pushes, receiver owns)"
          accent="mpls"
          columns={["Direction", "Receiver's block", "Label"]}
          rows={[
            ["PE1 → PE2", "PE2 · LB 25000", <Mono key="a">25000</Mono>],
            ["PE2 → PE1", "PE1 · LB 24000", <Mono key="b">24001</Mono>],
            ["PE1 → PE3", "PE3 · LB 26000", <Mono key="c">26000</Mono>],
            ["PE3 → PE1", "PE1 · LB 24000", <Mono key="d">24002</Mono>],
            ["PE2 → PE3", "PE3 · LB 26000", <Mono key="e">26001</Mono>],
            ["PE3 → PE2", "PE2 · LB 25000", <Mono key="f">25002</Mono>],
          ]}
        />
        <p>A pseudowire comes up only when both directions are imported and covered by the other side&apos;s block.</p>
      </GuideSection>

      <GuideSection id="bl-nomacs" eyebrow="Key distinction" title="What is NOT in the BGP table" tone="danger">
        <ChecklistCard
          tone="danger"
          mark="✕"
          title="The BGP VPLS table never contains"
          items={["CE1/CE2/CE3 MAC addresses", "Which PE a customer MAC sits behind", "Anything that stops unknown-unicast flooding"]}
        />
        <p>After the mesh comes up, every PE&apos;s FDB is still empty.</p>
      </GuideSection>

      <GuideSection id="bl-data" eyebrow="Data plane" title="Same data plane as LDP-VPLS" tone="warning">
        <DiagramFrame caption="Two-label stacks with BGP-derived inner labels.">
          <StackDiagram />
        </DiagramFrame>
        <p>The first CE1 → CE2 frame is unknown unicast: PE1 floods one copy to PE2 (<Mono>102 / 25000</Mono>) and one to PE3. Each learns CE1 → PW: PE1 from the frame itself, and mesh split horizon stops PE2 and PE3 relaying to each other.</p>
      </GuideSection>

      <GuideSection id="bl-known" eyebrow="Data plane" title="Known unicast" tone="success">
        <p>CE2&apos;s reply is known unicast at PE2: one copy <Mono>201 S0 / 24001 S1</Mono> to PE1, which learns CE2 → PW: PE2. BGP isn&apos;t consulted for any of it.</p>
      </GuideSection>

      <GuideSection id="bl-block-edge" eyebrow="Edge case" title="Outside the block: PE3 becomes VE 7" tone="warning">
        <p>
          When PE3 renumbers to VE ID 7, PE1&apos;s and PE2&apos;s blocks (VE 1–4) no longer contain a slot for it: PE3 → PE1 and PE3 → PE2 become <i>VE_ID_ABOVE_BLOCK</i>, so those PWs go down while PE1 ↔ PE2 is untouched. PE1 and PE2 fix it by widening their blocks to VBS 8 with the same base, so existing labels don&apos;t change.
        </p>
      </GuideSection>

      <GuideSection id="bl-withdraw" eyebrow="Control plane" title="Withdrawal and rejoin" tone="danger">
        <p>PE3 withdraws its VPLS NLRI: PE1 and PE2 remove PE3&apos;s membership and PE3-facing PWs, and PE1 ↔ PE2 keeps working. PE3 re-advertises and everything is rebuilt from the fresh UPDATE.</p>
      </GuideSection>

      <GuideSection id="bl-planes" eyebrow="Big picture" title="Control plane vs data plane" tone="violet">
        <CompareCards
          items={[
            { title: "Control plane", tone: "bgp", tag: "BGP took over", points: ["MP-BGP sessions to RR1", "Auto-discovery via RT import", "PW labels from label blocks", "Withdrawal removes membership"] },
            { title: "Data plane", tone: "success", tag: "unchanged", points: ["Source-MAC learning", "Unknown/BUM flooding", "Mesh split horizon", "Two-label forwarding"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="bl-fault" eyebrow="Troubleshooting" title="The CE3 membership incident" tone="danger">
        <DiagramFrame caption="The session is fine; the question is whether the route is imported.">
          <RtFaultDiagram />
        </DiagramFrame>
        <ChecklistCard
          tone="danger"
          mark="→"
          title="How to reason about it (no spoilers)"
          items={["Session Established is necessary, not sufficient.", "Check the address family, then compare received vs imported NLRI on each PE.", "Compare the policy values each PE advertises and imports.", "Verify with a real frame after repairing."]}
        />
      </GuideSection>

      <GuideSection id="bl-challenge" eyebrow="Challenge" title="Signal the virtual LAN" tone="violet">
        <p>The closing checklist covers transport, sessions, the address family, RDs, RT membership, VE IDs, label blocks, derived labels, the PW mesh, data-plane learning and the verified repair.</p>
      </GuideSection>

      <GuideSection id="bl-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "VE ID", def: "VPLS Edge identifier: per-PE site number inside one VPLS." },
            { term: "VBO", def: "VE Block Offset: first VE ID the block covers." },
            { term: "VBS", def: "VE Block Size: how many VE IDs the block covers." },
            { term: "Label Base", def: "First label of the block." },
            { term: "RD", def: "Makes each PE's NLRI unique." },
            { term: "RT", def: "Import/export membership policy." },
            { term: "AFI 25 / SAFI 65", def: "The L2VPN/VPLS MP-BGP address family." },
            { term: "RR1", def: "Route reflector: control plane only, never forwards frames." },
          ]}
        />
      </GuideSection>

      <GuideSection id="bl-recap" eyebrow="Recap" title="Mental model" tone="bgp">
        <div className="rounded-2xl border border-pv-bgp/30 bg-gradient-to-br from-pv-bgp/10 to-pv-violet/5 p-5 text-sm leading-relaxed text-pv-text">
          BGP-VPLS keeps the VPLS switch and changes the wiring crew. Each PE announces “I&apos;m in this VPLS (RT), I&apos;m site VE n, and here is my block of labels”. Every other PE picks its own slot from that block to send traffic. Once the wires exist, frames are switched exactly as before, learning MACs from traffic and flooding what they don&apos;t know.
        </div>
      </GuideSection>
    </>
  );
}
