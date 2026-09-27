import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DiagramFrame, DiagramSvg, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DRouteCard } from "@/components/lesson/EvpnGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { CORRECT_L2_MTU, ESI, LOCAL_SERVICE_LABEL, PE_LOOPBACK, TRANSPORT_LABEL_TO, VPWS_SERVICE_ID, type PeId } from "@/lib/sim-engine/scenarios/evpnVpws";

export const EVPNVP_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "dvp-model", label: "RFC 8214 mental model" },
  { id: "dvp-vs", label: "VPWS vs EVPN bridging" },
  { id: "dvp-route", label: "The per-EVI route" },
  { id: "dvp-l2attr", label: "Layer-2 Attributes EC" },
  { id: "dvp-down", label: "Downstream-assigned labels" },
  { id: "dvp-transport", label: "Transport vs service label" },
  { id: "dvp-converge", label: "Failure convergence" },
  { id: "dvp-mass", label: "Mass-withdraw tie-in" },
  { id: "dvp-transports", label: "MPLS vs VXLAN" },
  { id: "dvp-pw", label: "Traditional pseudowires" },
  { id: "dvp-trouble", label: "Troubleshooting" },
  { id: "dvp-verify", label: "Verification" },
  { id: "dvp-glossary", label: "Glossary" },
  { id: "dvp-mental", label: "Mental model" },
];

const PES: PeId[] = ["PE1", "PE2", "PE3"];

function ModelDiagram() {
  const box = (x: number, t: string, s: string, c: string) => (
    <g>
      <rect x={x} y={36} width={112} height={58} rx={10} fill={c} fillOpacity={0.12} stroke={c} strokeOpacity={0.75} />
      <text x={x + 56} y={60} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
        {t}
      </text>
      <text x={x + 56} y={78} textAnchor="middle" fill={D.muted} fontSize={9}>
        {s}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={150} label="RFC 8214: attachment circuit, service instance, per-EVI route, remote endpoint discovered, labels exchanged, point-to-point forwarding">
      {box(8, "AC", "port + VLAN", D.warning)}
      <DArrow x1={120} y1={65} x2={134} y2={65} color={D.faint} width={1.3} />
      {box(136, "Service ID", "Ethernet Tag", D.violet)}
      <DArrow x1={248} y1={65} x2={262} y2={65} color={D.faint} width={1.3} />
      {box(264, "A-D per-EVI", "both endpoints", D.bgp)}
      <DArrow x1={376} y1={65} x2={390} y2={65} color={D.faint} width={1.3} />
      {box(392, "Discovery", "remote endpoint", D.cyan)}
      <DArrow x1={504} y1={65} x2={518} y2={65} color={D.faint} width={1.3} />
      {box(520, "Forwarding", "labels, no MAC", D.success)}
      <text x={320} y={126} textAnchor="middle" fill={D.muted} fontSize={10}>
        the service is instantiated once each PE holds the other&apos;s per-EVI route
      </text>
    </DiagramSvg>
  );
}

function VsDiagram() {
  return (
    <DiagramSvg h={170} label="EVPN bridging: multipoint, destination MAC selects the remote site. EVPN-VPWS: two endpoints, the attachment circuit selects the service">
      <DNode x={130} y={40} label="Bridging (multipoint)" sub="dst MAC → which site?" accent={D.bgp} w={220} />
      <DArrow x1={130} y1={63} x2={60} y2={112} color={D.faint} />
      <DArrow x1={130} y1={63} x2={130} y2={112} color={D.faint} />
      <DArrow x1={130} y1={63} x2={200} y2={112} color={D.faint} />
      <DNode x={470} y={40} label="VPWS (point-to-point)" sub="AC → the one far end" accent={D.violet} w={220} />
      <DArrow x1={470} y1={63} x2={470} y2={112} color={D.violet} />
      <text x={130} y={134} textAnchor="middle" fill={D.muted} fontSize={10}>
        many possible sites
      </text>
      <text x={470} y={134} textAnchor="middle" fill={D.muted} fontSize={10}>
        exactly one remote endpoint
      </text>
    </DiagramSvg>
  );
}

function RouteDiagram() {
  return (
    <DiagramSvg h={210} label={`Per-EVI route for VPWS: RD, ESI ${ESI}, Ethernet Tag ${VPWS_SERVICE_ID} (service instance ID), MPLS label (the downstream service label), route target, Layer-2 Attributes community`}>
      <DRouteCard
        x={150}
        y={14}
        w={340}
        title={`Ethernet A-D per-EVI — PE1 (VPWS-${VPWS_SERVICE_ID})`}
        rows={[
          { label: "RD", value: `${PE_LOOPBACK.PE1}:${VPWS_SERVICE_ID}` },
          { label: "ESI", value: ESI },
          { label: "Ethernet Tag", value: `${VPWS_SERVICE_ID} (service instance ID)`, strong: true },
          { label: "MPLS label", value: `${LOCAL_SERVICE_LABEL.PE1} (downstream service label)`, strong: true },
          { label: "L2 Attributes EC", value: "P / B / C flags + L2 MTU" },
        ]}
      />
      <text x={320} y={180} textAnchor="middle" fill={D.muted} fontSize={10}>
        the Ethernet Tag MUST be the non-zero service ID (up to 24 bits, right-aligned) — RFC 8214 §3
      </text>
    </DiagramSvg>
  );
}

function L2AttrDiagram() {
  const bits = [
    { t: "MBZ", w: 280, c: D.faint },
    { t: "C", w: 60, c: D.cyan },
    { t: "P", w: 60, c: D.success },
    { t: "B", w: 60, c: D.warning },
  ];
  let x = 60;
  return (
    <DiagramSvg h={180} label={`EVPN Layer-2 Attributes extended community: control flags (C control word, P primary, B backup) and a 2-octet L2 MTU (${CORRECT_L2_MTU} in the healthy lesson state)`}>
      {bits.map((b) => {
        const cx = x;
        x += b.w + 4;
        return (
          <g key={b.t}>
            <rect x={cx} y={30} width={b.w} height={34} rx={6} fill={b.c} fillOpacity={0.14} stroke={b.c} />
            <text x={cx + b.w / 2} y={52} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
              {b.t}
            </text>
          </g>
        );
      })}
      <rect x={60} y={74} width={x - 64} height={30} rx={6} fill={D.violet} fillOpacity={0.12} stroke={D.violet} />
      <text x={60 + (x - 64) / 2} y={94} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        L2 MTU (2 octets) · {CORRECT_L2_MTU} healthy
      </text>
      <text x={320} y={134} textAnchor="middle" fill={D.text} fontSize={11}>
        Primary P=1 B=0 · Backup P=0 B=1 · others P=0 B=0
      </text>
      <text x={320} y={154} textAnchor="middle" fill={D.muted} fontSize={10}>
        a received MTU of 0 skips the check; a non-zero mismatch blocks the endpoint
      </text>
    </DiagramSvg>
  );
}

function DownstreamDiagram() {
  return (
    <DiagramSvg h={190} label={`Each PE advertises its own service label (${PES.map((p) => `${p} ${LOCAL_SERVICE_LABEL[p]}`).join(", ")}); a sender pushes the label advertised by the destination`}>
      {PES.map((p, i) => (
        <g key={p}>
          <DNode x={110 + i * 210} y={50} label={p} sub={`advertises ${LOCAL_SERVICE_LABEL[p]}`} accent={D.bgp} w={170} />
        </g>
      ))}
      <DArrow x1={520} y1={98} x2={120} y2={98} color={D.bgp} dashed label={`PE3 advertises service label ${LOCAL_SERVICE_LABEL.PE3}`} labelDy={-6} />
      <DArrow x1={120} y1={132} x2={520} y2={132} color={D.violet} label={`PE1 pushes ${LOCAL_SERVICE_LABEL.PE3} on traffic toward PE3`} labelDy={16} />
      <text x={320} y={170} textAnchor="middle" fill={D.muted} fontSize={10}>
        the receiver chooses the label; the sender never uses its own
      </text>
    </DiagramSvg>
  );
}

function TransportDiagram() {
  return (
    <DiagramSvg h={190} label={`Transport labels are per destination PE (${PES.map((p) => `${p} ${TRANSPORT_LABEL_TO[p]}`).join(", ")}); service labels are per VPWS endpoint`}>
      <DRouteCard x={30} y={16} w={270} title="Transport label (per destination PE)" color={D.mpls} rows={PES.map((p) => ({ label: `toward ${p}`, value: String(TRANSPORT_LABEL_TO[p]) }))} />
      <DRouteCard x={340} y={16} w={270} title="Service label (per endpoint)" color={D.violet} rows={PES.map((p) => ({ label: `${p}'s endpoint`, value: String(LOCAL_SERVICE_LABEL[p]) }))} />
      <text x={320} y={150} textAnchor="middle" fill={D.text} fontSize={11}>
        the core reads only the transport label; the destination PE reads the service label
      </text>
    </DiagramSvg>
  );
}

function ConvergeDiagram() {
  const box = (x: number, t: string, s: string, c: string) => (
    <g>
      <rect x={x} y={36} width={140} height={58} rx={10} fill={c} fillOpacity={0.12} stroke={c} strokeOpacity={0.75} />
      <text x={x + 70} y={60} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        {t}
      </text>
      <text x={x + 70} y={78} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        {s}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={160} label="Primary's service AC fails, it withdraws its per-EVI route, the remote PE switches to the backup, election re-runs and the new Primary signals P=1">
      {box(14, "AC down", "one service", D.danger)}
      <DArrow x1={156} y1={65} x2={172} y2={65} color={D.faint} width={1.4} />
      {box(174, "per-EVI withdrawn", "that service only", D.bgp)}
      <DArrow x1={316} y1={65} x2={332} y2={65} color={D.faint} width={1.4} />
      {box(334, "Remote switches", "to the backup PE", D.warning)}
      <DArrow x1={476} y1={65} x2={492} y2={65} color={D.faint} width={1.4} />
      {box(494, "Re-election", "new P / B flags", D.success)}
      <text x={320} y={128} textAnchor="middle" fill={D.muted} fontSize={10}>
        RFC 8214 §3.1 — a remote PE must see P=1 from at least one PE before forwarding
      </text>
    </DiagramSvg>
  );
}

function MassDiagram() {
  return (
    <DiagramSvg h={170} label="A per-EVI withdrawal affects one VPWS service; a per-ES withdrawal signals the whole segment for every service on it">
      <DRouteCard x={30} y={20} w={270} title="per-EVI withdrawal" color={D.bgp} rows={[{ label: "scope", value: "one service instance" }, { label: "this lesson", value: "PE1's VPWS AC down" }]} />
      <DRouteCard x={340} y={20} w={270} title="per-ES withdrawal" color={D.danger} rows={[{ label: "scope", value: "every service on the ES" }, { label: "when", value: "whole attachment down" }]} />
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        only the per-ES signal is mass withdrawal — the lesson connects to it, it does not rebuild it
      </text>
    </DiagramSvg>
  );
}

export function EvpnVpwsDeepDiveContent() {
  return (
    <>
      <GuideSection id="dvp-model" eyebrow="Standard" title="RFC 8214 mental model" tone="violet">
        <DiagramFrame caption="From attachment circuit to point-to-point forwarding.">
          <ModelDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dvp-vs" eyebrow="Model" title="VPWS vs EVPN bridging" tone="bgp">
        <DiagramFrame caption="The forwarding decision is service-based, not MAC-based.">
          <VsDiagram />
        </DiagramFrame>
        <p>Customer frames still carry MAC addresses; the provider simply does not need them to pick the far end. VPWS signaling does not use Type 2 routes.</p>
      </GuideSection>

      <GuideSection id="dvp-route" eyebrow="Control plane" title="The per-EVI route" tone="bgp">
        <DiagramFrame caption="The central VPWS signaling route.">
          <RouteDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dvp-l2attr" eyebrow="Control plane" title="Layer-2 Attributes EC" tone="warning">
        <DiagramFrame caption="Control flags and L2 MTU carried with the per-EVI route.">
          <L2AttrDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dvp-down" eyebrow="Labels" title="Downstream-assigned labels" tone="violet">
        <DiagramFrame caption="Local label advertised, remote label pushed.">
          <DownstreamDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dvp-transport" eyebrow="Labels" title="Transport vs service label" tone="mpls">
        <DiagramFrame caption="Two labels, two jobs.">
          <TransportDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dvp-converge" eyebrow="Failure" title="Failure convergence" tone="danger">
        <DiagramFrame caption="Single-Active failover for one service.">
          <ConvergeDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dvp-mass" eyebrow="Failure" title="Mass-withdraw tie-in" tone="danger">
        <DiagramFrame caption="Service-specific versus segment-wide signals.">
          <MassDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dvp-transports" eyebrow="Context" title="MPLS vs VXLAN" tone="ip">
        <p>RFC 8214&apos;s procedures do not depend on the tunnel. With VXLAN the per-EVI route&apos;s label field can carry a VNI instead of an MPLS service label. This lesson simulates MPLS only.</p>
      </GuideSection>

      <GuideSection id="dvp-pw" eyebrow="Context" title="Traditional pseudowires" tone="violet">
        <CompareCards
          items={[
            { title: "LDP pseudowire", tone: "cyan", tag: "traditional", points: ["Targeted LDP signals the PW label", "Redundancy via separate mechanisms", "Per-PW sessions"] },
            { title: "EVPN-VPWS", tone: "violet", tag: "this lesson", points: ["BGP EVPN signals labels and endpoints", "Multihoming built into EVPN", "Per-ES and per-EVI routes"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="dvp-trouble" eyebrow="Operations" title="Troubleshooting" tone="warning">
        <ChecklistCard tone="warning" title="Ladder" mark="→" items={["BGP EVPN sessions to every PE.", "Per-ES routes present with the expected Single-Active flag.", "Per-EVI routes from both endpoints with the right service ID.", "Exactly one Primary signaled (P=1).", "Layer-2 parameters (MTU, control word) compatible.", "Transport LSP to the destination PE.", "Customer frames delivered end to end."]} />
      </GuideSection>

      <GuideSection id="dvp-verify" eyebrow="Operations" title="Verification" tone="success">
        <ChecklistCard tone="success" title="Evidence" mark="✓" items={["Service state UP on both endpoints.", "Remote label equals the destination's advertised label.", "Failover moves traffic to the backup with its labels.", "Traffic flows again after any parameter repair."]} />
      </GuideSection>

      <GuideSection id="dvp-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Disposition PE", def: "The PE that removes the labels and delivers the customer frame." },
            { term: "C flag", def: "Control word required when sending to this PE." },
            { term: "EPL / EVPL", def: "Port-based / VLAN-based point-to-point Ethernet services." },
            { term: "Layer-2 Attributes EC", def: "Extended community carrying the P/B/C flags and L2 MTU." },
          ]}
        />
      </GuideSection>

      <GuideSection id="dvp-mental" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="Recap" icon="✓">
          EVPN-VPWS is two endpoints and a pair of downstream labels, signaled by per-EVI routes, protected by Single-Active multihoming, and checked by Layer-2 attributes before any frame is forwarded.
        </Callout>
      </GuideSection>
    </>
  );
}
