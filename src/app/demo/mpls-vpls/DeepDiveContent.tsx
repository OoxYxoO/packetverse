import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DiagramFrame, DiagramSvg, FieldTable, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const VPLS_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "pd-what", label: "Multipoint L2VPN" },
  { id: "pd-vsi", label: "VSI and bridge domain" },
  { id: "pd-mesh", label: "Full mesh and its cost" },
  { id: "pd-signal", label: "Signaling the mesh" },
  { id: "pd-decision", label: "The forwarding decision" },
  { id: "pd-bum", label: "BUM and ingress replication" },
  { id: "pd-loops", label: "Why split horizon exists" },
  { id: "pd-aging", label: "Aging and MAC moves" },
  { id: "pd-scale", label: "Scaling limitations" },
  { id: "pd-planes", label: "Control vs data plane" },
  { id: "pd-trouble", label: "Faults and verification" },
  { id: "pd-not", label: "What VPLS does NOT do" },
  { id: "pd-glossary", label: "Glossary" },
  { id: "pd-mental", label: "Mental model" },
];

function LanDiagram() {
  const sites: [string, number, number][] = [
    ["Site A", 80, 50],
    ["Site B", 560, 50],
    ["Site C", 80, 170],
    ["Site D", 560, 170],
  ];
  return (
    <DiagramSvg h={220} label="Four customer sites attached to one virtual Ethernet switch provided by the MPLS network">
      <rect x={220} y={60} width={200} height={100} rx={20} fill={D.mpls} fillOpacity={0.08} stroke={D.mpls} strokeDasharray="6 4" />
      <text x={320} y={105} textAnchor="middle" fill={D.mpls} fontSize={12} fontWeight={700}>
        one virtual LAN
      </text>
      <text x={320} y={124} textAnchor="middle" fill={D.muted} fontSize={10}>
        PEs + pseudowires + MPLS core
      </text>
      {sites.map(([n, x, y]) => (
        <g key={n}>
          <DLink x1={x < 320 ? x + 40 : x - 40} y1={y} x2={x < 320 ? 220 : 420} y2={y < 110 ? 80 : 140} color={D.ip} />
          <DNode x={x} y={y} label={n} accent={D.ip} w={80} />
        </g>
      ))}
    </DiagramSvg>
  );
}

function MeshGrowth() {
  const rows: [number, number][] = [
    [3, 3],
    [5, 10],
    [10, 45],
    [20, 190],
    [50, 1225],
  ];
  return (
    <DiagramSvg h={180} label="Full-mesh pseudowire count n(n-1)/2: 3 PEs 3, 5 PEs 10, 10 PEs 45, 20 PEs 190, 50 PEs 1225">
      {rows.map(([n, c], i) => {
        const w = Math.max(6, Math.log10(c + 1) * 130);
        return (
          <g key={n}>
            <text x={90} y={30 + i * 30} textAnchor="end" fill={D.text} fontSize={10.5}>
              {n} PEs
            </text>
            <rect x={100} y={18 + i * 30} width={w} height={18} rx={4} fill={D.violet} fillOpacity={0.3} stroke={D.violet} />
            <text x={108 + w} y={31 + i * 30} fill={D.violet} fontSize={10} fontWeight={700}>
              {c} PWs
            </text>
          </g>
        );
      })}
      <text x={600} y={170} textAnchor="end" fill={D.muted} fontSize={9.5}>
        log-scaled bars · each PW = targeted LDP state on both ends
      </text>
    </DiagramSvg>
  );
}

function DecisionDiagram() {
  const box = (x: number, y: number, t: string, c: string, w = 150) => <DPill x={x} y={y} text={t} color={c} w={w} />;
  return (
    <DiagramSvg h={230} label="Learn the source MAC on the ingress port, classify the destination, forward to one port if known, otherwise replicate to all except ingress, then apply split horizon">
      {box(100, 30, "frame arrives on a port", D.cyan, 170)}
      <DArrow x1={100} y1={43} x2={100} y2={67} color={D.faint} width={1.6} />
      {box(100, 80, "learn SOURCE MAC → port", D.success, 170)}
      <DArrow x1={100} y1={93} x2={100} y2={117} color={D.faint} width={1.6} />
      {box(100, 130, "classify DESTINATION", D.violet, 170)}
      <DArrow x1={186} y1={122} x2={330} y2={60} color={D.success} />
      <text x={232} y={78} textAnchor="middle" fill={D.success} fontSize={10} fontWeight={700}>
        known unicast
      </text>
      <DArrow x1={186} y1={138} x2={330} y2={180} color={D.warning} />
      <text x={150} y={200} fill={D.warning} fontSize={10} fontWeight={700}>
        unknown / broadcast / multicast
      </text>
      {box(460, 55, "send to that ONE port (not ingress)", D.success, 240)}
      {box(460, 170, "replicate to all ports except ingress", D.warning, 250)}
      <DArrow x1={460} y1={183} x2={460} y2={200} color={D.faint} width={1.6} />
      {box(460, 214, "…minus PWs if ingress was a PW", D.danger, 230)}
    </DiagramSvg>
  );
}

function LoopDiagram() {
  return (
    <DiagramSvg h={210} label="Without split horizon a broadcast from PE1 reaches PE2 and PE3, which relay it to each other and back to PE1, looping forever">
      <DNode x={320} y={40} label="PE1" accent={D.mpls} />
      <DNode x={140} y={170} label="PE2" accent={D.mpls} />
      <DNode x={500} y={170} label="PE3" accent={D.mpls} />
      <DArrow x1={280} y1={60} x2={180} y2={148} color={D.warning} />
      <DArrow x1={360} y1={60} x2={460} y2={148} color={D.warning} />
      <text x={236} y={84} textAnchor="end" fill={D.warning} fontSize={10} fontWeight={700}>
        copy
      </text>
      <text x={404} y={84} fill={D.warning} fontSize={10} fontWeight={700}>
        copy
      </text>
      <DArrow x1={192} y1={176} x2={448} y2={176} color={D.danger} both dashed label="relayed PW → PW (forbidden)" />
      <text x={320} y={120} textAnchor="middle" fill={D.danger} fontSize={11} fontWeight={700}>
        no TTL in Ethernet → endless copies
      </text>
    </DiagramSvg>
  );
}

function ReplicationDiagram() {
  return (
    <DiagramSvg h={170} label="Ingress replication sends one unicast copy per remote PE from the ingress PE; P2MP replication lets the core copy the packet">
      <text x={160} y={20} textAnchor="middle" fill={D.warning} fontSize={11} fontWeight={700}>
        ingress replication (this lesson)
      </text>
      <DNode x={60} y={90} label="PE1" accent={D.mpls} w={70} h={34} />
      {[40, 90, 140].map((y, i) => (
        <g key={y}>
          <DArrow x1={97} y1={90} x2={243} y2={y} color={D.warning} />
          <DNode x={270} y={y} label={`PE${i + 2}`} accent={D.mpls} w={50} h={28} />
        </g>
      ))}
      <text x={480} y={20} textAnchor="middle" fill={D.cyan} fontSize={11} fontWeight={700}>
        P2MP LSP (optimization, not modeled)
      </text>
      <DNode x={370} y={90} label="PE1" accent={D.mpls} w={70} h={34} />
      <DArrow x1={407} y1={90} x2={463} y2={90} color={D.cyan} />
      <DNode x={490} y={90} label="P" accent={D.faint} w={44} h={28} />
      {[40, 90, 140].map((y) => (
        <DArrow key={y} x1={513} y1={90} x2={573} y2={y} color={D.cyan} />
      ))}
      <text x={320} y={165} textAnchor="middle" fill={D.muted} fontSize={10}>
        ingress replication costs PE1 bandwidth per copy; P2MP moves the copying into the core
      </text>
    </DiagramSvg>
  );
}

function MoveDiagram() {
  return (
    <DiagramSvg h={150} label="A MAC learned on PW PE2 is relearned on PW PE3 when a frame from that MAC arrives there; the newest observation wins">
      <DPill x={130} y={40} text="CE2 MAC → PW: PE2" color={D.success} w={190} />
      <DArrow x1={230} y1={40} x2={390} y2={40} color={D.faint} />
      <text x={320} y={70} textAnchor="middle" fill={D.muted} fontSize={10}>
        frame from CE2 arrives via PW: PE3
      </text>
      <DPill x={510} y={40} text="CE2 MAC → PW: PE3" color={D.warning} w={190} />
      <text x={320} y={100} textAnchor="middle" fill={D.text} fontSize={10.5}>
        traditional VPLS: most recent observation wins, no sequence number
      </text>
      <text x={320} y={125} textAnchor="middle" fill={D.muted} fontSize={10}>
        stale entries elsewhere wait for aging (or optional LDP MAC Address Withdrawal)
      </text>
    </DiagramSvg>
  );
}

export function VplsDeepDiveContent() {
  return (
    <>
      <GuideSection id="pd-what" eyebrow="Concept" title="Multipoint L2VPN" tone="mpls">
        <p>
          VPLS (RFC 4762 for LDP signaling) makes a provider network behave like one Ethernet switch for a customer. Any number of sites attach through attachment circuits, and frames are switched by destination MAC, not by a fixed peer as in VPWS.
        </p>
        <DiagramFrame caption="The customer sees a LAN; the provider builds it from PEs and pseudowires.">
          <LanDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pd-vsi" eyebrow="Architecture" title="VSI and bridge domain" tone="violet">
        <FieldTable
          title="Terms you'll see for the same idea"
          accent="violet"
          columns={["Term", "Where"]}
          rows={[
            ["VSI (Virtual Switching Instance)", "RFC 4762 / many vendors"],
            ["Bridge domain", "Common CLI term"],
            ["VPLS instance / routing-instance", "Other vendors"],
            ["VPLS bridge context", "This PacketVerse lesson"],
          ]}
        />
        <p>Whatever the name, it is a per-service bridge with AC ports and PW ports, its own FDB, and its own flooding rules.</p>
      </GuideSection>

      <GuideSection id="pd-mesh" eyebrow="Architecture" title="Full mesh and its cost" tone="violet">
        <DiagramFrame caption="Pseudowire count grows quadratically with the number of PEs.">
          <MeshGrowth />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pd-signal" eyebrow="Control plane" title="Signaling the mesh" tone="violet">
        <CompareCards
          items={[
            { title: "LDP signaling (RFC 4762)", tone: "violet", tag: "this lesson", points: ["Targeted LDP session per PE pair", "PW labels exchanged per pair, per direction", "Members configured manually"] },
            { title: "BGP signaling (RFC 4761)", tone: "bgp", tag: "next lesson", points: ["Membership auto-discovered via BGP", "Labels signaled as label blocks", "Same data plane"] },
          ]}
        />
        <Callout tone="cyan" title="Two kinds of labels, again" icon="i">
          Each copy carries an outer transport label (toward the remote PE) and an inner PW label advertised by that remote PE. The receiver uses the inner label to find both the VPLS instance and which PW (bridge port) the frame arrived on.
        </Callout>
      </GuideSection>

      <GuideSection id="pd-decision" eyebrow="Data plane" title="The forwarding decision" tone="success">
        <DiagramFrame caption="Ordinary bridge logic, with one VPLS-specific rule at the end.">
          <DecisionDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pd-bum" eyebrow="Data plane" title="BUM and ingress replication" tone="warning">
        <FieldTable
          title="Traffic classes"
          accent="warning"
          columns={["Class", "Destination MAC", "Treatment"]}
          rows={[
            ["Known unicast", "In the FDB", "One copy to one port"],
            ["Unknown unicast", "Not in the FDB", "Replicate (BUM)"],
            ["Broadcast", "ff:ff:ff:ff:ff:ff", "Always replicate (BUM)"],
            ["Multicast", "Group bit set", "Replicate (BUM) unless snooping/optimization"],
          ]}
        />
        <DiagramFrame caption="Who makes the copies.">
          <ReplicationDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pd-loops" eyebrow="Loop prevention" title="Why split horizon exists" tone="danger">
        <DiagramFrame caption="Ethernet frames have no TTL; one relay between PWs would create a storm.">
          <LoopDiagram />
        </DiagramFrame>
        <p>
          Instead of running spanning tree across the core, VPLS forbids mesh-PW-to-mesh-PW forwarding and requires a full mesh so that relaying is never needed. Local ACs are unaffected. Hierarchical VPLS refines this rule for spoke PWs, and EVPN uses different mechanisms, so the flat-VPLS statement shouldn&apos;t be carried over blindly.
        </p>
      </GuideSection>

      <GuideSection id="pd-aging" eyebrow="Operations" title="Aging and MAC moves" tone="cyan">
        <DiagramFrame caption="Data-plane learning is self-correcting, but only when traffic flows.">
          <MoveDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pd-scale" eyebrow="Limits" title="Scaling limitations" tone="danger">
        <ChecklistCard
          tone="danger"
          mark="↗"
          title="Where flat LDP-VPLS hurts"
          items={["n(n−1)/2 pseudowires and targeted LDP sessions.", "Manual member configuration on every PE.", "Ingress replication load for BUM at the ingress PE.", "Flood-and-learn: unknown traffic floods until learned.", "No native all-active multihoming."]}
        />
        <p>BGP-VPLS addresses discovery and signaling, H-VPLS addresses the mesh size, and EVPN moves MAC reachability into the control plane.</p>
      </GuideSection>

      <GuideSection id="pd-planes" eyebrow="Big picture" title="Control plane vs data plane" tone="violet">
        <CompareCards
          items={[
            { title: "Control plane", tone: "violet", tag: "service setup", points: ["IGP + transport LSPs", "Targeted LDP per PE pair", "PW labels, PW status"] },
            { title: "Data plane", tone: "success", tag: "all MAC knowledge", points: ["Source learning, aging", "Known vs unknown lookup", "BUM replication, split horizon"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-trouble" eyebrow="Operations" title="Faults and verification" tone="danger">
        <FieldTable
          title="Common VPLS faults"
          accent="danger"
          columns={["Symptom", "Likely cause"]}
          rows={[
            ["One site pair can't talk, others fine", "One mesh PW down (split horizon prevents relaying)"],
            ["All remote sites unreachable from one PE", "Transport LSP or targeted LDP from that PE"],
            ["Traffic floods constantly", "MAC not learned (asymmetric traffic, aging too short)"],
            ["Intermittent reachability after a move", "Stale FDB entries waiting to age out"],
          ]}
        />
        <FieldTable
          title="Verification ideas"
          accent="cyan"
          columns={["What", "Command idea"]}
          rows={[
            ["PW mesh state", "show l2vpn vfi / show vpls connections"],
            ["MAC table", "show l2vpn bridge-domain mac / show vpls mac-table"],
            ["Targeted LDP", "show mpls ldp neighbor"],
            ["Per-PW labels", "show mpls l2transport vc detail"],
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-not" eyebrow="Boundaries" title="What traditional VPLS does NOT do" tone="danger">
        <ChecklistCard
          tone="danger"
          mark="✕"
          title="Not in traditional VPLS"
          items={["Advertise customer MAC addresses in a control protocol.", "Relay between mesh pseudowires.", "Provide native all-active multihoming.", "Keep customer state on P routers.", "Suppress ARP or route between subnets."]}
        />
      </GuideSection>

      <GuideSection id="pd-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "VSI", def: "Per-PE virtual switch for one VPLS instance." },
            { term: "Mesh PW", def: "Pseudowire between two VPLS PEs." },
            { term: "Ingress replication", def: "The ingress PE sends one labeled copy per remote PE." },
            { term: "Split horizon", def: "No forwarding from one mesh PW to another." },
            { term: "Flood-and-learn", def: "Learning MACs from traffic, flooding until learned." },
            { term: "MAC withdrawal", def: "Optional LDP message to flush stale MACs faster." },
            { term: "RFC 4762", def: "VPLS using LDP signaling." },
            { term: "RFC 4761", def: "VPLS using BGP auto-discovery and signaling." },
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-mental" eyebrow="Recap" title="Mental model" tone="mpls">
        <div className="rounded-2xl border border-pv-mpls/30 bg-gradient-to-br from-pv-mpls/10 to-pv-violet/5 p-5 text-sm leading-relaxed text-pv-text">
          The control plane builds a fully meshed set of wires; the data plane turns them into a switch. All MAC knowledge lives in per-PE FDBs filled by watching traffic. BUM is copied once per remote PE, and split horizon plus the full mesh keeps those copies loop-free.
        </div>
      </GuideSection>
    </>
  );
}
