import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DRegion, DiagramFrame, DiagramSvg, FieldTable, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const HVPLS_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "hd-why", label: "Why hierarchy" },
  { id: "hd-model", label: "The two-tier model" },
  { id: "hd-scale", label: "Scaling math" },
  { id: "hd-access", label: "Access options" },
  { id: "hd-rules", label: "Spoke vs mesh forwarding" },
  { id: "hd-spoke2spoke", label: "Spoke to spoke via a hub" },
  { id: "hd-learning", label: "MAC learning per tier" },
  { id: "hd-bum", label: "BUM in a hierarchy" },
  { id: "hd-redundancy", label: "Redundancy" },
  { id: "hd-failure", label: "Failure domains" },
  { id: "hd-tradeoffs", label: "Trade-offs" },
  { id: "hd-trouble", label: "Faults and verification" },
  { id: "hd-not", label: "What H-VPLS does NOT do" },
  { id: "hd-glossary", label: "Glossary" },
  { id: "hd-mental", label: "Mental model" },
];

function ModelDiagram() {
  return (
    <DiagramSvg h={228} label="Access tier of MTU-s bridges each with one spoke to a PE-rs; core tier of PE-rs in a full mesh">
      <DRegion x={140} y={16} w={360} h={90} label="core tier: PE-rs full mesh" color={D.mpls} />
      <DRegion x={20} y={130} w={600} h={88} label="" color={D.warning} />
      {/* Label sits at the bottom edge: the spokes climb out through the top of this region. */}
      <text x={32} y={211} fill={D.warning} fontSize={10} fontWeight={700}>
        access tier: MTU-s bridges
      </text>
      {[210, 320, 430].map((x, i) => (
        <DNode key={x} x={x} y={66} label={`PE-rs ${i + 1}`} accent={D.mpls} w={86} h={32} />
      ))}
      <DLink x1={253} y1={66} x2={277} y2={66} color={D.violet} />
      <DLink x1={363} y1={66} x2={387} y2={66} color={D.violet} />
      <path d="M210 50 Q320 20 430 50" fill="none" stroke={D.violet} strokeWidth={2} />
      {[80, 190, 300, 410, 520].map((x, i) => {
        const hub = [210, 210, 320, 430, 430][i];
        return (
          <g key={x}>
            <DLink x1={x} y1={160} x2={hub} y2={82} color={D.warning} dashed />
            <DNode x={x} y={175} label={`MTU-s ${i + 1}`} accent={D.warning} w={80} h={30} />
          </g>
        );
      })}
    </DiagramSvg>
  );
}

function ScaleDiagram() {
  const rows: [number, number, number][] = [
    [10, 45, 13],
    [30, 435, 33],
    [100, 4950, 103],
  ];
  return (
    <DiagramSvg h={150} label="With 3 PE-rs: 10 sites flat 45 vs hierarchical 13; 30 sites 435 vs 33; 100 sites 4950 vs 103">
      {rows.map(([n, flat, hier], i) => {
        const f = Math.log10(flat) * 110;
        const h = Math.log10(hier) * 110;
        return (
          <g key={n}>
            <text x={80} y={32 + i * 42} textAnchor="end" fill={D.text} fontSize={10.5}>
              {n} sites
            </text>
            <rect x={90} y={20 + i * 42} width={f} height={14} rx={3} fill={D.danger} fillOpacity={0.35} />
            <text x={96 + f} y={32 + i * 42} fill={D.danger} fontSize={9.5}>
              flat {flat}
            </text>
            <rect x={90} y={36 + i * 42} width={h} height={10} rx={3} fill={D.success} fillOpacity={0.4} />
            <text x={96 + h} y={45 + i * 42} fill={D.success} fontSize={9.5}>
              H-VPLS {hier}
            </text>
          </g>
        );
      })}
      <text x={620} y={145} textAnchor="end" fill={D.muted} fontSize={9.5}>
        3 PE-rs core (3 mesh PWs) + one spoke per site · log-scaled bars
      </text>
    </DiagramSvg>
  );
}

function MatrixDiagram() {
  const roles = ["AC", "SPOKE", "MESH"];
  return (
    <DiagramSvg h={170} label="Forwarding matrix: every combination allowed except mesh ingress to mesh egress">
      <text x={130} y={24} textAnchor="middle" fill={D.muted} fontSize={10}>
        ingress ↓ / egress →
      </text>
      {roles.map((r, i) => (
        <text key={`c${r}`} x={260 + i * 110} y={24} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
          {r}
        </text>
      ))}
      {roles.map((row, i) => (
        <g key={row}>
          <text x={130} y={62 + i * 42} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
            {row}
          </text>
          {roles.map((col, j) => {
            const no = row === "MESH" && col === "MESH";
            return (
              <g key={col}>
                <rect x={215 + j * 110} y={42 + i * 42} width={90} height={32} rx={8} fill={no ? D.danger : D.success} fillOpacity={0.15} stroke={no ? D.danger : D.success} />
                <text x={260 + j * 110} y={63 + i * 42} textAnchor="middle" fill={no ? D.danger : D.success} fontSize={13} fontWeight={700}>
                  {no ? "✕" : "✓"}
                </text>
              </g>
            );
          })}
        </g>
      ))}
    </DiagramSvg>
  );
}

function SpokeToSpoke() {
  return (
    <DiagramSvg h={180} label="Two MTU-s on the same PE-rs reach each other through the hub: spoke in, spoke out">
      <DNode x={320} y={40} label="PE-rs" accent={D.mpls} w={90} />
      <DNode x={150} y={125} label="MTU-s A" accent={D.warning} w={90} />
      <DNode x={490} y={125} label="MTU-s B" accent={D.warning} w={90} />
      <DArrow x1={190} y1={108} x2={280} y2={58} color={D.warning} />
      <DArrow x1={360} y1={58} x2={450} y2={108} color={D.warning} />
      <text x={222} y={74} textAnchor="end" fill={D.warning} fontSize={10} fontWeight={700}>
        spoke in
      </text>
      <text x={418} y={74} fill={D.warning} fontSize={10} fontWeight={700}>
        spoke out ✓
      </text>
      <text x={320} y={172} textAnchor="middle" fill={D.muted} fontSize={10}>
        the hub bridges between its own spokes; no direct MTU-s ↔ MTU-s PW is needed
      </text>
    </DiagramSvg>
  );
}

function RedundancyDiagram() {
  return (
    <DiagramSvg h={170} label="An MTU-s dual-homed to two PE-rs with a primary and a standby spoke">
      <DNode x={120} y={85} label="MTU-s" accent={D.warning} w={90} />
      <DNode x={440} y={40} label="PE-rs 1" accent={D.mpls} w={90} />
      <DNode x={440} y={130} label="PE-rs 2" accent={D.mpls} w={90} />
      <DLink x1={165} y1={78} x2={395} y2={44} color={D.success} label="primary spoke" labelDy={-6} />
      <DLink x1={165} y1={92} x2={395} y2={126} color={D.faint} dashed label="standby spoke" labelDy={18} />
      <DLink x1={440} y1={56} x2={440} y2={114} color={D.violet} />
      <text x={432} y={89} textAnchor="end" fill={D.violet} fontSize={10} fontWeight={700}>
        mesh
      </text>
      <text x={600} y={90} textAnchor="end" fill={D.muted} fontSize={9.5}>
        only one spoke forwards at a time
      </text>
    </DiagramSvg>
  );
}

function FailureDiagram() {
  return (
    <DiagramSvg h={170} label="A spoke failure isolates one access site from the core; a PE-rs failure isolates every MTU-s behind it; a mesh PW failure is local to that pair">
      <DPill x={130} y={40} text="spoke fails" color={D.warning} w={120} />
      <text x={130} y={70} textAnchor="middle" fill={D.text} fontSize={10}>
        that MTU-s: remote cut
      </text>
      <text x={130} y={86} textAnchor="middle" fill={D.success} fontSize={10}>
        local switching survives
      </text>
      <DPill x={320} y={40} text="PE-rs fails" color={D.danger} w={120} />
      <text x={320} y={70} textAnchor="middle" fill={D.text} fontSize={10}>
        every MTU-s on that hub
      </text>
      <text x={320} y={86} textAnchor="middle" fill={D.muted} fontSize={10}>
        unless dual-homed
      </text>
      <DPill x={510} y={40} text="mesh PW fails" color={D.violet} w={130} />
      <text x={510} y={70} textAnchor="middle" fill={D.text} fontSize={10}>
        that hub pair only
      </text>
      <text x={510} y={86} textAnchor="middle" fill={D.muted} fontSize={10}>
        no relay via a third hub
      </text>
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        hierarchy concentrates state, and concentrates impact
      </text>
    </DiagramSvg>
  );
}

export function HvplsDeepDiveContent() {
  return (
    <>
      <GuideSection id="hd-why" eyebrow="Motivation" title="Why hierarchy" tone="mpls">
        <p>
          Flat VPLS needs every member PE fully meshed, with its sessions, labels and BUM replication load growing with the mesh. Many access sites are small and just need to join the LAN. H-VPLS (RFC 4762 §10) lets them attach through a hub instead of joining the mesh.
        </p>
      </GuideSection>

      <GuideSection id="hd-model" eyebrow="Architecture" title="The two-tier model" tone="violet">
        <DiagramFrame caption="Only the core tier is fully meshed.">
          <ModelDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="hd-scale" eyebrow="Scaling" title="Scaling math" tone="success">
        <DiagramFrame caption="Flat n(n−1)/2 vs core mesh + one spoke per site.">
          <ScaleDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="hd-access" eyebrow="Architecture" title="Access options" tone="warning">
        <CompareCards
          items={[
            { title: "MPLS spoke PW", tone: "warning", tag: "this lesson", points: ["MTU-s runs MPLS and signals a PW", "Spoke is an LDP-signaled pseudowire", "Access tier is MPLS-aware"] },
            { title: "Ethernet access", tone: "cyan", tag: "alternative", points: ["MTU-s uses 802.1ad (QinQ) toward the PE-rs", "No PW at the access tier", "Named only, not modeled"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="hd-rules" eyebrow="Forwarding" title="Spoke vs mesh forwarding" tone="danger">
        <DiagramFrame caption="At a PE-rs, a spoke PW is treated like an attachment circuit.">
          <MatrixDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Why only mesh → mesh is blocked" icon="!">
          The core is a full mesh, so every hub already receives its own copy from the ingress hub. Relaying mesh → mesh would create loops. Spokes are tree branches hanging off exactly one hub, so forwarding into or out of them can&apos;t create a loop in the mesh.
        </Callout>
      </GuideSection>

      <GuideSection id="hd-spoke2spoke" eyebrow="Forwarding" title="Spoke to spoke via a hub" tone="warning">
        <DiagramFrame caption="Allowed: the hub bridges between its own spokes.">
          <SpokeToSpoke />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="hd-learning" eyebrow="Data plane" title="MAC learning per tier" tone="success">
        <FieldTable
          title="Who learns what"
          accent="success"
          columns={["Device", "Learns", "Scale"]}
          rows={[
            ["MTU-s", "Its local customers on ACs; everything else behind its one spoke", "Small"],
            ["PE-rs", "Every customer MAC in the VPLS: on spokes and mesh PWs", "Large"],
            ["P router", "Nothing (transport only)", "None"],
          ]}
        />
        <p>Learning is still data-plane flood-and-learn at every tier. Each table is independent.</p>
      </GuideSection>

      <GuideSection id="hd-bum" eyebrow="Data plane" title="BUM in a hierarchy" tone="warning">
        <p>
          The ingress MTU-s floods to its local ACs and its spoke; the ingress PE-rs replicates to every mesh peer and its other spokes; each receiving PE-rs sends only to its spokes/ACs. Replication work is concentrated at the hubs, and the MTU-s sends just one copy upstream.
        </p>
      </GuideSection>

      <GuideSection id="hd-redundancy" eyebrow="Resilience" title="Redundancy" tone="cyan">
        <DiagramFrame caption="Dual-homing removes the single-hub dependency (named in the lesson, not simulated).">
          <RedundancyDiagram />
        </DiagramFrame>
        <p>Only one spoke should forward at a time. Otherwise two hubs would each deliver BUM into the same access bridge and create a loop, so dual-homed designs use a primary/standby mechanism.</p>
      </GuideSection>

      <GuideSection id="hd-failure" eyebrow="Resilience" title="Failure domains" tone="danger">
        <DiagramFrame caption="What breaks when each element fails.">
          <FailureDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="hd-tradeoffs" eyebrow="Design" title="Trade-offs" tone="violet">
        <CompareCards
          items={[
            { title: "You gain", tone: "success", tag: "benefits", points: ["Linear access growth", "Simple MTU-s devices", "Local switching at the edge", "Smaller core mesh"] },
            { title: "You accept", tone: "warning", tag: "costs", points: ["Hubs carry all remote MACs and BUM load", "Hub or spoke failures affect whole sites", "Still flood-and-learn, still no MAC control plane", "Extra configuration for port roles"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="hd-trouble" eyebrow="Operations" title="Faults and verification" tone="danger">
        <FieldTable
          title="Common H-VPLS faults"
          accent="danger"
          columns={["Symptom", "Likely cause"]}
          rows={[
            ["Local works, remote fails, all PWs up", "Spoke misconfigured as a mesh (split-horizon) PW at the hub"],
            ["One access site fully isolated from remote sites", "Spoke PW down"],
            ["Loops / storms after adding redundancy", "Both spokes of a dual-homed MTU-s forwarding"],
            ["Two remote hubs can't exchange traffic", "Core mesh PW down (no relay by design)"],
          ]}
        />
        <FieldTable
          title="Verification ideas"
          accent="cyan"
          columns={["What", "Command idea"]}
          rows={[
            ["PW roles (spoke vs mesh / split-horizon group)", "show l2vpn bridge-domain detail"],
            ["Spoke/mesh PW state", "show mpls l2transport vc / show vpls connections"],
            ["MAC tables per tier", "show mac address-table / show vpls mac-table"],
          ]}
        />
      </GuideSection>

      <GuideSection id="hd-not" eyebrow="Boundaries" title="What H-VPLS does NOT do" tone="danger">
        <ChecklistCard
          tone="danger"
          mark="✕"
          title="Not H-VPLS's job"
          items={["Change MAC learning into a control-plane function.", "Remove BUM flooding.", "Automatically discover members (combine with BGP-VPLS for that).", "Eliminate the core full mesh: it only shrinks it.", "Provide native all-active multihoming."]}
        />
      </GuideSection>

      <GuideSection id="hd-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "MTU-s", def: "Access-tier bridging device with one spoke to a hub." },
            { term: "PE-rs", def: "Core-tier hub: routing + bridging, fully meshed." },
            { term: "Spoke PW", def: "Access pseudowire, treated like an AC at the hub." },
            { term: "Mesh PW", def: "Core pseudowire, subject to split horizon." },
            { term: "Split-horizon group", def: "Vendor term for ports that must not forward to each other." },
            { term: "Dual-homing", def: "An MTU-s attached to two hubs with one active spoke." },
            { term: "QinQ access", def: "Ethernet-based access tier instead of MPLS spokes." },
          ]}
        />
      </GuideSection>

      <GuideSection id="hd-mental" eyebrow="Recap" title="Mental model" tone="mpls">
        <div className="rounded-2xl border border-pv-mpls/30 bg-gradient-to-br from-pv-mpls/10 to-pv-violet/5 p-5 text-sm leading-relaxed text-pv-text">
          Think of access switches plus a small, fully meshed set of core switches. Access switches have one uplink and switch locally; the core is fully meshed and must never pass a frame from one core link to another. Everything else about VPLS — flood and learn, two-label pseudowires — stays the same.
        </div>
      </GuideSection>
    </>
  );
}
