import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DNode, DPill, DiagramFrame, DiagramSvg, FieldTable, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ARCH_COLOR, ARCH_NAME, ArchSnapshot, type Arch } from "./evoSvg";

export const EVO_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "ed-matrix", label: "The full comparison" },
  { id: "ed-service", label: "Service type" },
  { id: "ed-discovery", label: "Discovery and signaling" },
  { id: "ed-pw", label: "Pseudowire requirements" },
  { id: "ed-mac", label: "MAC learning plane" },
  { id: "ed-bum", label: "BUM handling" },
  { id: "ed-split", label: "Split horizon" },
  { id: "ed-mh", label: "Multihoming" },
  { id: "ed-failure", label: "Failure signaling" },
  { id: "ed-scale", label: "Scaling characteristics" },
  { id: "ed-state", label: "Who holds which state" },
  { id: "ed-planes", label: "Control plane over time" },
  { id: "ed-choose", label: "Design is requirement-driven" },
  { id: "ed-glossary", label: "Glossary" },
  { id: "ed-mental", label: "Mental model" },
];

const ORDER: Arch[] = ["VPWS", "VPLS", "BGP_VPLS", "H_VPLS", "EVPN"];

function Matrix({ rows, title, h = 230 }: { rows: [string, string[]][]; title: string; h?: number }) {
  return (
    <DiagramSvg h={h} label={title}>
      {ORDER.map((a, i) => (
        <text key={a} x={190 + i * 98} y={20} textAnchor="middle" fill={ARCH_COLOR[a]} fontSize={10.5} fontWeight={700}>
          {ARCH_NAME[a]}
        </text>
      ))}
      {rows.map(([dim, vals], r) => (
        <g key={dim}>
          <text x={12} y={48 + r * 36} fill={D.text} fontSize={10.5} fontWeight={700}>
            {dim}
          </text>
          {vals.map((v, i) => (
            <g key={i}>
              <rect x={144 + i * 98} y={32 + r * 36} width={92} height={28} rx={6} fill={ARCH_COLOR[ORDER[i]]} fillOpacity={0.1} stroke={ARCH_COLOR[ORDER[i]]} strokeOpacity={0.5} />
              <text x={190 + i * 98} y={50 + r * 36} textAnchor="middle" fill={D.text} fontSize={9}>
                {v}
              </text>
            </g>
          ))}
        </g>
      ))}
    </DiagramSvg>
  );
}

function PlaneShift() {
  const rows: [Arch, string[], string[]][] = [
    ["VPWS", ["targeted LDP", "PW label"], []],
    ["VPLS", ["targeted LDP mesh", "PW labels"], ["MAC learning", "BUM flood"]],
    ["BGP_VPLS", ["BGP discovery", "label blocks"], ["MAC learning", "BUM flood"]],
    ["H_VPLS", ["spoke + mesh PWs"], ["MAC learning", "BUM flood"]],
    ["EVPN", ["BGP discovery", "labels", "MAC/IP (Type 2)", "ES / DF"], ["local learning", "BUM (Type 3 list)"]],
  ];
  return (
    <DiagramSvg h={230} label="Which functions live in the control plane versus the data plane for each architecture; EVPN moves MAC/IP reachability into the control plane">
      <text x={250} y={18} textAnchor="middle" fill={D.bgp} fontSize={10.5} fontWeight={700}>
        control plane
      </text>
      <text x={530} y={18} textAnchor="middle" fill={D.success} fontSize={10.5} fontWeight={700}>
        data plane
      </text>
      {rows.map(([a, cp, dp], i) => (
        <g key={a}>
          <text x={12} y={48 + i * 40} fill={ARCH_COLOR[a]} fontSize={10.5} fontWeight={700}>
            {ARCH_NAME[a]}
          </text>
          <text x={250} y={48 + i * 40} textAnchor="middle" fill={D.text} fontSize={9.5}>
            {cp.join(" · ")}
          </text>
          <text x={530} y={48 + i * 40} textAnchor="middle" fill={D.text} fontSize={9.5}>
            {dp.join(" · ") || "(no MAC decisions)"}
          </text>
        </g>
      ))}
    </DiagramSvg>
  );
}

function MhDiagram() {
  return (
    <DiagramSvg h={190} label="A dual-homed CE: traditional VPLS needs vendor or active/standby mechanisms; EVPN uses an Ethernet Segment with DF election and aliasing">
      <text x={160} y={20} textAnchor="middle" fill={ARCH_COLOR.VPLS} fontSize={11} fontWeight={700}>
        traditional VPLS family
      </text>
      <DNode x={160} y={150} label="CE" accent={D.ip} w={70} h={30} />
      <DNode x={90} y={70} label="PE A" accent={D.mpls} w={70} h={30} />
      <DNode x={230} y={70} label="PE B" accent={D.faint} w={70} h={30} />
      <DArrow x1={150} y1={134} x2={100} y2={86} color={D.success} />
      <DArrow x1={170} y1={134} x2={220} y2={86} color={D.faint} />
      <text x={160} y={184} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        typically active/standby, design- or vendor-specific
      </text>
      <text x={480} y={20} textAnchor="middle" fill={ARCH_COLOR.EVPN} fontSize={11} fontWeight={700}>
        EVPN
      </text>
      <DNode x={480} y={150} label="CE" accent={D.ip} w={70} h={30} />
      <DNode x={410} y={70} label="PE A · DF" accent={D.success} w={80} h={30} />
      <DNode x={550} y={70} label="PE B" accent={D.success} w={70} h={30} />
      <DArrow x1={470} y1={134} x2={420} y2={86} color={D.success} />
      <DArrow x1={490} y1={134} x2={540} y2={86} color={D.success} />
      <DPill x={480} y={110} text="ESI" color={D.success} w={50} />
      <text x={480} y={184} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        all-active or single-active, DF election, aliasing
      </text>
    </DiagramSvg>
  );
}

function FailureDiagram() {
  return (
    <DiagramSvg h={170} label="Traditional families recover MAC state by aging, relearning or optional MAC withdrawal; EVPN withdraws routes and can mass-withdraw per Ethernet Segment">
      <DPill x={160} y={40} text="PW / PE failure" color={D.danger} w={150} />
      <DArrow x1={160} y1={54} x2={160} y2={84} color={D.faint} width={1.4} />
      <DPill x={160} y={100} text="stale MACs age out or relearn" color={D.warning} w={230} />
      <text x={160} y={140} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        optional LDP MAC Address Withdrawal
      </text>
      <DPill x={480} y={40} text="link / ES failure" color={D.danger} w={150} />
      <DArrow x1={480} y1={54} x2={480} y2={84} color={D.faint} width={1.4} />
      <DPill x={480} y={100} text="route withdrawal (per-ES mass withdraw)" color={D.success} w={270} />
      <text x={480} y={140} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        remote PEs update without waiting for traffic
      </text>
    </DiagramSvg>
  );
}

function ScaleDiagram() {
  return (
    <DiagramSvg h={150} label="Five thumbnails with their dominant scaling concern">
      {ORDER.map((a, i) => (
        <g key={a}>
          <ArchSnapshot arch={a} cx={68 + i * 126} cy={55} />
          <text x={68 + i * 126} y={118} textAnchor="middle" fill={ARCH_COLOR[a]} fontSize={10} fontWeight={700}>
            {ARCH_NAME[a]}
          </text>
          <text x={68 + i * 126} y={136} textAnchor="middle" fill={D.muted} fontSize={8.5}>
            {["1 PW per service", "n(n−1)/2 PWs", "BGP state, same mesh", "core mesh + spokes", "BGP routes per MAC/IP"][i]}
          </text>
        </g>
      ))}
    </DiagramSvg>
  );
}

export function EvoDeepDiveContent() {
  return (
    <>
      <GuideSection id="ed-matrix" eyebrow="Overview" title="The full comparison" tone="violet">
        <DiagramFrame caption="The lesson's own comparison dimensions, condensed.">
          <Matrix
            title="Comparison matrix of five architectures across service type, discovery, signaling, MAC plane and multihoming"
            rows={[
              ["Service", ["point-to-point", "multipoint", "multipoint", "multipoint", "multipoint*"]],
              ["Discovery", ["manual", "manual", "BGP (RT)", "manual†", "BGP (RT)"]],
              ["Signaling", ["targeted LDP", "targeted LDP", "BGP blocks", "spoke+mesh", "BGP EVPN"]],
              ["MAC plane", ["n/a", "data", "data", "data", "control"]],
              ["Multihoming", ["—", "not native", "not native", "not native", "native (ES)"]],
            ]}
          />
        </DiagramFrame>
        <p className="text-xs text-pv-text-faint">* EVPN also has a point-to-point form (EVPN-VPWS). † H-VPLS can be combined with a BGP-signaled core; the lesson treats that as an orthogonal choice.</p>
      </GuideSection>

      <GuideSection id="ed-service" eyebrow="Dimension" title="Service type" tone="mpls">
        <p>VPWS is point-to-point: no bridging, no MAC table. Every VPLS variant and EVPN provide a multipoint bridge domain; EVPN can also provide point-to-point service (EVPN-VPWS), which has its own lesson.</p>
      </GuideSection>

      <GuideSection id="ed-discovery" eyebrow="Dimension" title="Discovery and signaling" tone="bgp">
        <FieldTable
          title="How PEs find each other and exchange service labels"
          accent="bgp"
          columns={["Architecture", "Discovery", "Signaling"]}
          rows={[
            ["VPWS", "Remote PE configured", "Targeted LDP, PWid FEC 128"],
            ["LDP-VPLS", "Every pair configured", "Targeted LDP per pair"],
            ["BGP-VPLS", "BGP, RT import", "Label blocks in the VPLS NLRI"],
            ["H-VPLS", "Configured per tier", "Spoke and mesh PWs (LDP here)"],
            ["EVPN", "BGP, RT import", "EVPN routes (labels per EVI/MAC)"],
          ]}
        />
      </GuideSection>

      <GuideSection id="ed-pw" eyebrow="Dimension" title="Pseudowire requirements" tone="violet">
        <FieldTable
          title="How many service relationships"
          accent="violet"
          columns={["Architecture", "Relationships for N sites"]}
          rows={[
            ["VPWS", "1 PW per point-to-point service"],
            ["LDP-VPLS / BGP-VPLS", "N(N−1)/2 PWs (BGP-VPLS signals them automatically)"],
            ["H-VPLS", "Core mesh among hubs + 1 spoke per access site"],
            ["EVPN (MPLS)", "No per-pair PWs; BGP sessions (often via RRs) + labels"],
          ]}
        />
      </GuideSection>

      <GuideSection id="ed-mac" eyebrow="Dimension" title="MAC learning plane" tone="success">
        <p>
          In every traditional architecture a PE learns a remote MAC only after traffic from it crosses a pseudowire (flood and learn). EVPN PEs still learn <i>local</i> MACs from traffic, but advertise them in BGP Type 2 routes, so remote PEs learn them from the control plane.
        </p>
        <Callout tone="warning" title="BGP ≠ control-plane MAC learning" icon="!">
          BGP-VPLS uses BGP, yet its MAC learning is data-plane. The protocol name doesn&apos;t decide the learning plane; what the routes carry does.
        </Callout>
      </GuideSection>

      <GuideSection id="ed-bum" eyebrow="Dimension" title="BUM handling" tone="warning">
        <FieldTable
          title="BUM"
          accent="warning"
          columns={["Architecture", "Who is in the replication list", "Traffic"]}
          rows={[
            ["LDP / BGP-VPLS", "Every PE with a PW", "Ingress replication over PWs"],
            ["H-VPLS", "Local ACs/spoke, then mesh peers", "Replicated at each tier"],
            ["EVPN", "PEs that sent a Type 3 (IMET) route", "Ingress replication or underlay multicast"],
          ]}
        />
        <p>EVPN can reduce unknown-unicast flooding (MACs are often known in advance) and can suppress ARP, but BUM traffic itself still exists.</p>
      </GuideSection>

      <GuideSection id="ed-split" eyebrow="Dimension" title="Split horizon" tone="danger">
        <FieldTable
          title="Loop prevention"
          accent="danger"
          columns={["Architecture", "Rule"]}
          rows={[
            ["VPWS", "Not applicable (one remote port)"],
            ["LDP / BGP-VPLS", "Mesh PW → mesh PW forbidden"],
            ["H-VPLS", "Only mesh → mesh forbidden; spokes behave like ACs"],
            ["EVPN", "ESI-based split horizon for multihomed segments + DF election for BUM"],
          ]}
        />
      </GuideSection>

      <GuideSection id="ed-mh" eyebrow="Dimension" title="Multihoming" tone="success">
        <DiagramFrame caption="Native multihoming is one of EVPN's defining additions.">
          <MhDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ed-failure" eyebrow="Dimension" title="Failure signaling" tone="danger">
        <DiagramFrame caption="Data-plane state recovers through traffic; control-plane state recovers through routes.">
          <FailureDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ed-scale" eyebrow="Dimension" title="Scaling characteristics" tone="cyan">
        <DiagramFrame caption="Each architecture moves the scaling pressure somewhere else; none removes it.">
          <ScaleDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ed-state" eyebrow="Dimension" title="Who holds which state" tone="violet">
        <FieldTable
          title="State ownership (from the lesson)"
          accent="violet"
          columns={["Node", "Customer FDB", "PW / NLRI state", "EVPN routes"]}
          rows={[
            ["P router (any)", "✕", "✕ transport labels only", "✕"],
            ["Traditional VPLS PE", "✓", "✓ PW state", "✕"],
            ["BGP-VPLS route reflector", "✕", "VPLS NLRI only", "✕"],
            ["BGP-VPLS PE", "✓", "✓ PW state + NLRI", "✕"],
            ["EVPN route reflector", "✕", "✕", "✓ relays only"],
            ["EVPN PE", "✓", "model-dependent", "✓"],
          ]}
        />
      </GuideSection>

      <GuideSection id="ed-planes" eyebrow="Synthesis" title="How the control plane grew" tone="bgp">
        <DiagramFrame caption="Functions move from data plane to control plane only in the last step.">
          <PlaneShift />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ed-choose" eyebrow="Design" title="Design is requirement-driven" tone="cyan">
        <ChecklistCard
          tone="cyan"
          mark="→"
          title="Operational complexity cuts both ways"
          items={[
            "VPWS: minimal state, but only two endpoints.",
            "LDP-VPLS: simple concepts, heavy mesh configuration at scale.",
            "BGP-VPLS: automation, but requires an L2VPN BGP design and RRs.",
            "H-VPLS: smaller core mesh, but more tiers and roles to get right.",
            "EVPN: richest features, but the most control-plane state and concepts.",
          ]}
        />
        <p>No architecture is best for every network. Start from the service and operational requirements, check each architecture against all of them, and prefer the simplest design that satisfies every one.</p>
      </GuideSection>

      <GuideSection id="ed-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "EVI", def: "EVPN instance: the EVPN equivalent of a VPLS service." },
            { term: "IMET", def: "Inclusive Multicast Ethernet Tag route (EVPN Type 3)." },
            { term: "Aliasing", def: "EVPN load-balancing toward all PEs of a multihomed segment." },
            { term: "Mass withdrawal", def: "Withdrawing all MACs of an Ethernet Segment with one route." },
            { term: "Flood and learn", def: "Data-plane MAC learning." },
            { term: "RT Constraint", def: "Limits which VPN routes RRs send to each PE." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ed-mental" eyebrow="Recap" title="Mental model" tone="violet">
        <div className="rounded-2xl border border-pv-violet/30 bg-gradient-to-br from-pv-violet/10 to-pv-mpls/5 p-5 text-sm leading-relaxed text-pv-text">
          Line the five up and change one thing at a time: the number of endpoints, who configures the wires, how big the mesh gets, and finally whether MAC knowledge comes from traffic or from routes. Each change solves a real problem and adds its own cost; the right answer is whichever set of trade-offs your requirements can afford.
        </div>
      </GuideSection>
    </>
  );
}
