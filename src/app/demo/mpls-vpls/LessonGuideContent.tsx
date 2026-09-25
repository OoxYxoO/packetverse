import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const VPLS_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "pl-mission", label: "The mission" },
  { id: "pl-topology", label: "Sites and PEs" },
  { id: "pl-bridge", label: "The VPLS bridge context" },
  { id: "pl-transport", label: "Transport first" },
  { id: "pl-mesh", label: "The pseudowire full mesh" },
  { id: "pl-labels", label: "Six directional labels" },
  { id: "pl-empty", label: "Ready, but empty" },
  { id: "pl-learn", label: "Source-MAC learning" },
  { id: "pl-unknown", label: "Unknown unicast" },
  { id: "pl-replicas", label: "Two replicas, two stacks" },
  { id: "pl-remote", label: "Remote learning" },
  { id: "pl-split", label: "PW split horizon" },
  { id: "pl-bum", label: "Broadcast and BUM" },
  { id: "pl-known", label: "Known unicast" },
  { id: "pl-aging", label: "Aging and MAC moves" },
  { id: "pl-planes", label: "Control vs data plane" },
  { id: "pl-fault", label: "The CE1 ↔ CE3 incident" },
  { id: "pl-challenge", label: "The engineer challenge" },
  { id: "pl-glossary", label: "Glossary" },
  { id: "pl-recap", label: "Mental model" },
];

const PE: Record<string, [number, number]> = { PE1: [150, 110], PE2: [480, 45], PE3: [480, 175] };

/** Label position along a PW; a vertical PW gets its labels beside the line, clear of the node boxes. */
function pwLabelPos(x1: number, y1: number, x2: number, y2: number, t: number) {
  if (x1 === x2) return { x: x1 + 8, y: y1 + (y2 - y1) * (t < 0.5 ? 0.32 : 0.68) + 3, textAnchor: "start" as const };
  return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t - 6, textAnchor: "middle" as const };
}

function ServiceMesh({ labels = true, down, highlight }: { labels?: boolean; down?: string; highlight?: string[] }) {
  const pairs: [string, string, string, string][] = [
    ["PE1", "PE2", "24012", "25021"],
    ["PE1", "PE3", "24013", "26031"],
    ["PE2", "PE3", "25023", "26032"],
  ];
  return (
    <>
      {pairs.map(([a, b, la, lb]) => {
        const id = `${a}-${b}`;
        const isDown = down === id;
        const hot = highlight?.includes(id);
        const [x1, y1] = PE[a];
        const [x2, y2] = PE[b];
        return (
          <g key={id}>
            <DLink x1={x1} y1={y1} x2={x2} y2={y2} color={isDown ? D.danger : hot ? D.warning : D.violet} dashed={isDown} />
            {labels && !isDown && (
              <>
                <text {...pwLabelPos(x1, y1, x2, y2, 0.2)} fill={D.muted} fontSize={9} fontFamily="monospace">
                  {la}
                </text>
                <text {...pwLabelPos(x1, y1, x2, y2, 0.8)} fill={D.muted} fontSize={9} fontFamily="monospace">
                  {lb}
                </text>
              </>
            )}
          </g>
        );
      })}
      <DLink x1={60} y1={110} x2={100} y2={110} color={D.ip} />
      <DLink x1={530} y1={45} x2={575} y2={45} color={D.ip} />
      <DLink x1={530} y1={175} x2={575} y2={175} color={D.ip} />
      <DNode x={40} y={110} label="CE1" accent={D.ip} w={50} h={30} />
      <DNode x={600} y={45} label="CE2" accent={D.ip} w={50} h={30} />
      <DNode x={600} y={175} label="CE3" accent={D.ip} w={50} h={30} />
      {Object.entries(PE).map(([id, [x, y]]) => (
        <DNode key={id} x={x} y={y} label={id} sub="VSI" accent={D.mpls} w={90} />
      ))}
    </>
  );
}

function MeshDiagram() {
  return (
    <DiagramSvg h={220} label="PE1, PE2 and PE3 full mesh with receive labels at each end: 24012/25021, 24013/26031, 25023/26032">
      <ServiceMesh />
      <text x={320} y={214} textAnchor="middle" fill={D.muted} fontSize={10}>
        the label printed next to a PE is the one THAT PE advertised and receives on
      </text>
    </DiagramSvg>
  );
}

function LearningDiagram() {
  const col = (x: number, title: string, rows: string[], c: string) => (
    <g>
      <text x={x} y={20} textAnchor="middle" fill={c} fontSize={10.5} fontWeight={700}>
        {title}
      </text>
      {["PE1", "PE2", "PE3"].map((pe, i) => (
        <g key={pe}>
          <rect x={x - 90} y={32 + i * 52} width={180} height={44} rx={8} fill={D.box} stroke={D.line} />
          <text x={x - 82} y={48 + i * 52} fill={D.muted} fontSize={9} fontWeight={700}>
            {pe}
          </text>
          <text x={x - 82} y={64 + i * 52} fill={D.text} fontSize={9} fontFamily="monospace">
            {rows[i] || "—"}
          </text>
        </g>
      ))}
    </g>
  );
  return (
    <DiagramSvg h={200} label="After the first frame all three PEs know CE1; after CE2's reply PE1 and PE2 know both; after the next frame nothing new">
      {col(110, "1 · CE1 → CE2 (flooded)", ["CE1 → AC", "CE1 → PW: PE1", "CE1 → PW: PE1"], D.warning)}
      {col(320, "2 · CE2 → CE1 (direct)", ["CE1 → AC · CE2 → PW: PE2", "CE1 → PW: PE1 · CE2 → AC", "CE1 → PW: PE1"], D.success)}
      {col(530, "3 · CE1 → CE2 (known)", ["no change, one copy", "no change", "sees nothing"], D.cyan)}
    </DiagramSvg>
  );
}

function ReplicaDiagram() {
  return (
    <DiagramSvg h={240} label="PE1 sends one copy to PE2 with 102 over 25021 and one copy to PE3 with 103 over 26031">
      <DNode x={80} y={120} label="PE1" sub="unknown dst" accent={D.mpls} w={100} />
      <DNode x={560} y={50} label="PE2" accent={D.mpls} w={80} />
      <DNode x={560} y={190} label="PE3" accent={D.mpls} w={80} />
      <DArrow x1={132} y1={108} x2={518} y2={54} color={D.warning} />
      <DArrow x1={132} y1={132} x2={518} y2={186} color={D.warning} />
      <DStack x={300} y={4} labels={[{ text: "102 S0" }, { text: "25021 S1", color: D.violet }]} payload="Ethernet" w={82} />
      <DStack x={300} y={170} labels={[{ text: "103 S0" }, { text: "26031 S1", color: D.violet }]} payload="Ethernet" w={82} />
      <text x={420} y={124} fill={D.muted} fontSize={9.5}>
        separate stack per replica
      </text>
    </DiagramSvg>
  );
}

function SplitDiagram() {
  return (
    <DiagramSvg h={220} label="PE2 receives a flooded frame on PW from PE1: it may send to its AC toward CE2 but never out the PW to PE3">
      <ServiceMesh labels={false} highlight={["PE1-PE2"]} />
      <DPill x={480} y={110} text="PE2 → PE3 ✕" color={D.danger} w={110} />
      <text x={416} y={114} textAnchor="end" fill={D.danger} fontSize={10} fontWeight={700}>
        split horizon
      </text>
      <text x={320} y={214} textAnchor="middle" fill={D.muted} fontSize={10}>
        PE3 already got its own copy directly from PE1, so nothing is lost
      </text>
    </DiagramSvg>
  );
}

function FaultDiagram() {
  return (
    <DiagramSvg h={220} label="With PW PE1-PE3 down, PE1 floods only to PE2 and PE2 cannot relay to PE3, so CE3 never receives CE1's frame">
      <ServiceMesh labels={false} down="PE1-PE3" highlight={["PE1-PE2"]} />
      <DPill x={300} y={138} text="PW PE1–PE3 DOWN" color={D.danger} w={130} />
      <DPill x={560} y={110} text="PE2 → PE3 blocked" color={D.danger} w={140} />
    </DiagramSvg>
  );
}

export function VplsLessonGuideContent() {
  return (
    <>
      <GuideSection id="pl-mission" eyebrow="Introduction" title="The mission: one virtual LAN for three sites" tone="mpls">
        <p>
          CE1, CE2 and CE3 (<Mono>192.168.100.1–3</Mono>, VLAN <Mono>100</Mono>) must share one Ethernet broadcast domain, as if plugged into the same switch. A point-to-point VPWS can&apos;t do that. This lesson builds <Mono>CUST-A-VPLS</Mono>: a mesh of pseudowires with a virtual bridge on every PE.
        </p>
        <Callout tone="cyan" title="Scope of this simulation" icon="i">
          Traditional LDP-signaled VPLS with three PEs, one AC each. Targeted LDP is modeled as one shared mesh-wide state. BGP-VPLS, H-VPLS and EVPN are later lessons. LDP MAC Address Withdrawal is named, not simulated.
        </Callout>
      </GuideSection>

      <GuideSection id="pl-topology" eyebrow="Setup" title="Sites and PEs" tone="cyan">
        <FieldTable
          title="CUST-A sites"
          accent="ip"
          columns={["Site", "MAC", "PE / AC"]}
          rows={[
            ["CE1", <Mono key="1">00:11:11:11:11:11</Mono>, "PE1 (1.1.1.1) ge-0/0/0.100"],
            ["CE2", <Mono key="2">00:22:22:22:22:22</Mono>, "PE2 (2.2.2.2) ge-0/0/0.100"],
            ["CE3", <Mono key="3">00:33:33:33:33:33</Mono>, "PE3 (3.3.3.3) ge-0/0/0.100"],
          ]}
        />
        <p>P1 (10.10.10.1) branches to P2 and P3; the P routers are transport-only transit and hold no VPLS state.</p>
      </GuideSection>

      <GuideSection id="pl-bridge" eyebrow="Service" title="The VPLS bridge context (VSI)" tone="violet">
        <p>
          Each PE runs a per-service virtual Ethernet bridge. Some vendors call it a <b className="text-pv-text">VSI</b>; PacketVerse calls it a &quot;VPLS bridge context&quot;. Its ports are the local <b className="text-pv-text">AC</b> plus one <b className="text-pv-text">PW port</b> per remote PE. The service identity <Mono>VPLS-500</Mono> is shared mesh-wide and is different from any single PW and from VLAN 100.
        </p>
      </GuideSection>

      <GuideSection id="pl-transport" eyebrow="Prerequisite" title="Transport first" tone="mpls">
        <p>IGP, then hop-by-hop LDP, then LSPs between every PE loopback, exactly as in VPWS. P1 advertises <Mono>102</Mono> toward PE2 and <Mono>103</Mono> toward PE3; P2 advertises <Mono>201</Mono> toward PE1.</p>
      </GuideSection>

      <GuideSection id="pl-mesh" eyebrow="Control plane" title="The pseudowire full mesh" tone="violet">
        <DiagramFrame caption="Three PEs, three pseudowires: PE1–PE2, PE1–PE3, PE2–PE3.">
          <MeshDiagram />
        </DiagramFrame>
        <p>Each pair gets its own pseudowire, signaled over targeted LDP between the PE loopbacks. You&apos;ll see why every pair needs one in the split-horizon section.</p>
      </GuideSection>

      <GuideSection id="pl-labels" eyebrow="Control plane" title="Six directional labels" tone="mpls">
        <FieldTable
          title="Receive labels (the receiver owns them)"
          accent="mpls"
          columns={["Pseudowire", "Label the receiver advertised", "Used by the sender"]}
          rows={[
            ["PE1 → PE2", <Mono key="a">25021</Mono>, "PE1 pushes it toward PE2"],
            ["PE2 → PE1", <Mono key="b">24012</Mono>, "PE2 pushes it toward PE1"],
            ["PE1 → PE3", <Mono key="c">26031</Mono>, "PE1 pushes it toward PE3"],
            ["PE3 → PE1", <Mono key="d">24013</Mono>, "PE3 pushes it toward PE1"],
            ["PE2 → PE3", <Mono key="e">26032</Mono>, "PE2 pushes it toward PE3"],
            ["PE3 → PE2", <Mono key="f">25023</Mono>, "PE3 pushes it toward PE2"],
          ]}
        />
      </GuideSection>

      <GuideSection id="pl-empty" eyebrow="State" title="Ready, but empty" tone="cyan">
        <p>Transport UP, targeted LDP OPERATIONAL, three PWs UP, three ACs UP, and every FDB completely empty. The bridge exists but knows nothing yet.</p>
      </GuideSection>

      <GuideSection id="pl-learn" eyebrow="Data plane" title="Source-MAC learning" tone="success">
        <p>Every PE learns the <b className="text-pv-text">source</b> MAC of every frame it receives, on the port it arrived on (AC or PW), before making any forwarding decision.</p>
        <DiagramFrame caption="Three frames, three FDB snapshots: learning comes from the traffic itself.">
          <LearningDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pl-unknown" eyebrow="Data plane" title="Unknown unicast" tone="warning">
        <p>
          The first frame is CE1 → <Mono>00:22:22:22:22:22</Mono>. PE1 has never seen that MAC, so it&apos;s <b className="text-pv-text">unknown unicast</b>. PE1 replicates it to every eligible bridge port except the one it arrived on: PW: PE2 and PW: PE3. Ingress was the AC, so split horizon doesn&apos;t limit it.
        </p>
      </GuideSection>

      <GuideSection id="pl-replicas" eyebrow="Data plane" title="Two replicas, two label stacks" tone="warning">
        <DiagramFrame caption="Flooding in VPLS is ingress replication: one labeled copy per remote PE, never a shared multicast label.">
          <ReplicaDiagram />
        </DiagramFrame>
        <p>The copy to PE2 goes PE1 → P1 → P2 (PHP) → PE2; the copy to PE3 goes PE1 → P1 → P3 (PHP) → PE3. P routers act only on the outer label.</p>
      </GuideSection>

      <GuideSection id="pl-remote" eyebrow="Data plane" title="Remote learning" tone="success">
        <p>
          PE2 resolves <Mono>25021</Mono> → CUST-A-VPLS, arriving on PW: PE1, and learns <Mono>00:11:11:11:11:11 → PW: PE1</Mono>. PE3 does the same. CE2 accepts the frame; CE3 discards it (wrong destination MAC).
        </p>
      </GuideSection>

      <GuideSection id="pl-split" eyebrow="Loop prevention" title="Pseudowire split horizon" tone="danger">
        <DiagramFrame caption="A frame received on a mesh PW may go to local ACs, never to another mesh PW.">
          <SplitDiagram />
        </DiagramFrame>
        <ChecklistCard
          tone="danger"
          mark="!"
          title="Scope of the rule (flat VPLS)"
          items={["Applies to frames that ARRIVED on a mesh PW.", "Frames arriving on a local AC may be flooded to every PW.", "It is why the mesh must be full: no PE can rely on another to relay.", "It is not IP distance-vector split horizon."]}
        />
      </GuideSection>

      <GuideSection id="pl-bum" eyebrow="Data plane" title="Broadcast and BUM" tone="warning">
        <p>
          CE1&apos;s ARP request to <Mono>ff:ff:ff:ff:ff:ff</Mono> is <b className="text-pv-text">broadcast</b>: no lookup, always replicated to PW: PE2 and PW: PE3; each of them floods to its AC only. <b className="text-pv-text">BUM</b> (broadcast, unknown unicast, multicast) all get this same service-aware replication, subject to split horizon.
        </p>
      </GuideSection>

      <GuideSection id="pl-known" eyebrow="Data plane" title="Known unicast" tone="success">
        <FlowSteps
          steps={[
            { title: "CE2 replies to CE1", body: <>PE2 learns CE2 → AC and already knows CE1 → PW: PE1: one copy with <Mono>201 S0 / 24012 S1</Mono>.</>, tone: "success" },
            { title: "PE1 learns CE2", body: "The core forwards via P2 → P1 (PHP at P1); PE1 learns CE2 → PW: PE2.", tone: "success" },
            { title: "CE1 → CE2 again", body: <>Known unicast: one copy <Mono>102 S0 / 25021 S1</Mono> to PE2. PE3 sees nothing.</>, tone: "cyan" },
          ]}
        />
      </GuideSection>

      <GuideSection id="pl-aging" eyebrow="Operations" title="Aging and MAC moves" tone="cyan">
        <p>
          When PE1 ages out CE2&apos;s entry, the next frame is unknown again and floods. When CE2 reappears behind PE3, PE1 simply relearns the MAC on the new port (PW: PE3). Traditional VPLS has no sequence numbers: the most recently observed source wins.
        </p>
      </GuideSection>

      <GuideSection id="pl-planes" eyebrow="Big picture" title="Control plane vs data plane" tone="violet">
        <CompareCards
          items={[
            { title: "Control plane", tone: "violet", tag: "builds the service", points: ["Transport LSPs", "Targeted LDP mesh", "PW labels (six, directional)"] },
            { title: "Data plane", tone: "success", tag: "switches frames", points: ["Source-MAC learning", "Destination lookup: known vs unknown", "BUM replication, split horizon"] },
          ]}
        />
        <Callout tone="warning" title="No MAC advertisements here" icon="!">
          Traditional VPLS never advertises customer MACs in a control protocol. Every FDB entry comes from observed traffic. That is exactly what EVPN later changes.
        </Callout>
      </GuideSection>

      <GuideSection id="pl-fault" eyebrow="Troubleshooting" title="The CE1 ↔ CE3 incident" tone="danger">
        <DiagramFrame caption="Why CE1 ↔ CE2 and CE2 ↔ CE3 keep working while CE1 ↔ CE3 fails.">
          <FaultDiagram />
        </DiagramFrame>
        <ChecklistCard
          tone="danger"
          mark="→"
          title="How to reason about it (no spoilers)"
          items={["Check transport, targeted LDP and ACs first.", "Then check every mesh leg individually.", "Ask why another PE can't simply relay the missing traffic.", "Verify with a real frame after repairing."]}
        />
      </GuideSection>

      <GuideSection id="pl-challenge" eyebrow="Challenge" title="Build the virtual LAN" tone="violet">
        <p>The closing challenge is a checklist of what you demonstrated: transport, targeted LDP mesh, bridge contexts, full-mesh PWs with six labels, source learning, flooding, split horizon, known unicast, aging and the verified repair.</p>
      </GuideSection>

      <GuideSection id="pl-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "VPLS", def: "Virtual Private LAN Service: multipoint Ethernet over pseudowires." },
            { term: "VSI", def: "Virtual Switching Instance: the per-PE bridge for one VPLS." },
            { term: "FDB", def: "Forwarding database (MAC table) per PE." },
            { term: "BUM", def: "Broadcast, Unknown unicast, Multicast: replicated traffic." },
            { term: "Split horizon", def: "Mesh-PW ingress never leaves on another mesh PW." },
            { term: "Full mesh", def: "A PW between every pair of PEs: n(n−1)/2." },
            { term: "Aging", def: "Removing an FDB entry after a period without traffic." },
            { term: "MAC move", def: "Relearning a MAC on a different port." },
          ]}
        />
      </GuideSection>

      <GuideSection id="pl-recap" eyebrow="Recap" title="Mental model" tone="mpls">
        <div className="rounded-2xl border border-pv-mpls/30 bg-gradient-to-br from-pv-mpls/10 to-pv-violet/5 p-5 text-sm leading-relaxed text-pv-text">
          VPLS is a distributed Ethernet switch. Each PE is one switch, its pseudowires are uplinks to every other PE, and the switches learn from traffic like any bridge. Unknown and broadcast frames are copied to every PE; learned MACs go to exactly one. Split horizon keeps copies from bouncing around the mesh, which is why the mesh must be full.
        </div>
      </GuideSection>
    </>
  );
}
