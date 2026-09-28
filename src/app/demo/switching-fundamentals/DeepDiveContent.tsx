import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { BROADCAST_MAC, PRIMARY_PORT, SECONDARY_PORT } from "@/lib/sim-engine/scenarios/switchingFundamentals";
import { HostNote, SwNote, TwoSwitches } from "./guideSvg";

export const SWF_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "swd-terms", label: "Bridge vs switch" },
  { id: "swd-pipeline", label: "Bridge pipeline" },
  { id: "swd-views", label: "Local vs remote entries" },
  { id: "swd-partial", label: "Partial knowledge" },
  { id: "swd-domains", label: "Collision vs broadcast" },
  { id: "swd-modes", label: "Store-and-forward" },
  { id: "swd-loops", label: "Forwarding loops" },
  { id: "swd-flap", label: "MAC flapping" },
  { id: "swd-prevention", label: "Loop prevention" },
  { id: "swd-workflow", label: "Troubleshooting" },
  { id: "swd-verify", label: "Verification" },
  { id: "swd-model", label: "Mental model" },
  { id: "swd-glossary", label: "Glossary" },
];

const P = PRIMARY_PORT;
const S2 = SECONDARY_PORT;

function PipelineDiagram() {
  const stages = [
    { t: "Receive", s: "check FCS", c: D.eth },
    { t: "Learn", s: "SOURCE → ingress", c: D.warning },
    { t: "Look up", s: "DESTINATION", c: D.cyan },
    { t: "Decide", s: "forward/flood/filter", c: D.violet },
    { t: "Transmit", s: "frame unchanged", c: D.success },
  ];
  return (
    <DiagramSvg h={150} label="Bridge pipeline: receive and check FCS, learn the source MAC against the ingress port, look up the destination MAC, decide to forward, flood or filter, transmit the frame unchanged">
      {stages.map((st, i) => (
        <g key={st.t}>
          <DNode x={70 + i * 125} y={60} label={st.t} sub={st.s} accent={st.c} w={112} h={48} />
          {i < stages.length - 1 && <DArrow x1={128 + i * 125} y1={60} x2={137 + i * 125} y2={60} color={D.muted} width={1.6} />}
        </g>
      ))}
      <text x={320} y={118} textAnchor="middle" fill={D.muted} fontSize={10}>
        Learning uses only the source field. Forwarding uses only the destination field.
      </text>
      <text x={320} y={136} textAnchor="middle" fill={D.muted} fontSize={10}>
        Every switch on the path runs this whole pipeline again, with its own table.
      </text>
    </DiagramSvg>
  );
}

function ViewsDiagram() {
  return (
    <DiagramSvg h={250} label={`Local versus remote entries: SW1 sees HOST-A and HOST-D on local ports and HOST-B and HOST-C behind ${P}; SW2 sees the reverse`}>
      <TwoSwitches primary="idle" secondary="down" subs={{ SW1: "A, D local", SW2: "B, C local" }}>
        <SwNote sw="SW1" dy={-44} text={`B, C → ${P}`} color={D.violet} />
        <SwNote sw="SW2" dy={-44} text={`A, D → ${P}`} color={D.violet} />
      </TwoSwitches>
      <text x={320} y={242} textAnchor="middle" fill={D.muted} fontSize={10}>
        An entry on an inter-switch port means &quot;beyond the other switch&quot; — never which port over there.
      </text>
    </DiagramSvg>
  );
}

function PartialDiagram() {
  return (
    <DiagramSvg h={250} label="Partial knowledge: HOST-C sends to HOST-D; SW2 has no entry for HOST-D and floods to HOST-B and SW1; SW1 has HOST-D on ge-0/0/2 and forwards to that port only">
      <TwoSwitches hosts={{ C: "in", B: "out", D: "out" }} primary="left" secondary="down" subs={{ SW1: "HIT D", SW2: "MISS D" }}>
        <SwNote sw="SW2" dy={-44} text="unknown → flood" color={D.warning} />
        <SwNote sw="SW1" dy={-44} text="known → ge-0/0/2" color={D.success} />
        <HostNote h="B" text="discards" color={D.danger} />
        <HostNote h="D" text="accepts" color={D.success} />
      </TwoSwitches>
      <text x={320} y={242} textAnchor="middle" fill={D.muted} fontSize={10}>
        One frame, two bridges, two different answers — both correct for their own table.
      </text>
    </DiagramSvg>
  );
}

function DomainsDiagram() {
  const ports = [
    { x: 80, y: 60, t: "HOST-A" },
    { x: 80, y: 150, t: "HOST-D" },
    { x: 560, y: 60, t: "HOST-B" },
    { x: 560, y: 150, t: "HOST-C" },
  ];
  return (
    <DiagramSvg h={250} label="Collision domains versus broadcast domain: every full-duplex switch port is its own link with no collisions; all four hosts and both switches form one broadcast domain">
      <rect x={16} y={14} width={608} height={186} rx={16} fill={D.warning} fillOpacity={0.04} stroke={D.warning} strokeOpacity={0.45} strokeDasharray="6 5" />
      <text x={30} y={32} fill={D.warning} fontSize={10} fontWeight={700}>
        ONE broadcast domain (both switches)
      </text>
      {ports.map((p) => (
        <g key={p.t}>
          <rect x={p.x - 62} y={p.y - 30} width={124} height={60} rx={10} fill={D.cyan} fillOpacity={0.05} stroke={D.cyan} strokeOpacity={0.5} />
          <DNode x={p.x} y={p.y + 4} label={p.t} w={96} h={34} />
        </g>
      ))}
      <DNode x={240} y={105} label="SW1" accent={D.violet} w={80} h={36} />
      <DNode x={400} y={105} label="SW2" accent={D.violet} w={80} h={36} />
      <DLink x1={280} y1={105} x2={360} y2={105} color={D.violet} />
      <DLink x1={142} y1={70} x2={200} y2={98} color={D.line} />
      <DLink x1={142} y1={146} x2={200} y2={112} color={D.line} />
      <DLink x1={440} y1={98} x2={498} y2={70} color={D.line} />
      <DLink x1={440} y1={112} x2={498} y2={146} color={D.line} />
      <text x={30} y={224} fill={D.cyan} fontSize={10} fontWeight={700}>
        Each cyan box: one full-duplex link = its own collision domain (no collisions at all).
      </text>
      <text x={30} y={242} fill={D.muted} fontSize={10}>
        Switches separate collision domains. Only a router (or a VLAN boundary) separates broadcast domains.
      </text>
    </DiagramSvg>
  );
}

function LoopGeneralDiagram() {
  const sw = [
    { id: "X", x: 150, y: 70 },
    { id: "Y", x: 490, y: 70 },
    { id: "Z", x: 320, y: 190 },
  ];
  return (
    <DiagramSvg h={250} label="Forwarding loops in general: any closed ring of active links between bridges; with two parallel links a copy bounces between two switches, with more redundant ports each copy is flooded out several ports and the count multiplies">
      <DArrow x1={200} y1={70} x2={440} y2={70} color={D.danger} both width={1.8} />
      <DArrow x1={470} y1={98} x2={360} y2={172} color={D.danger} both width={1.8} />
      <DArrow x1={170} y1={98} x2={280} y2={172} color={D.danger} both width={1.8} />
      {sw.map((s) => (
        <DNode key={s.id} x={s.x} y={s.y} label={`SW-${s.id}`} accent={D.violet} w={90} />
      ))}
      <DPill x={320} y={128} text="any ring of active links" color={D.danger} />
      <text x={24} y={228} fill={D.text} fontSize={10.5} fontWeight={700}>
        Two links between two switches: copies bounce back and forth, forever.
      </text>
      <text x={24} y={246} fill={D.muted} fontSize={10}>
        A bridge with several looped ports floods each copy out all of them, so the count multiplies every pass.
      </text>
    </DiagramSvg>
  );
}

function FlapDiagram() {
  const steps = [
    { port: "ge-0/0/1", why: "HOST-A's real frame", c: D.success },
    { port: P, why: "looped copy returns", c: D.danger },
    { port: S2, why: "other looped copy", c: D.danger },
    { port: P, why: "next wave …", c: D.danger },
  ];
  return (
    <DiagramSvg h={170} label={`MAC flapping on SW1: HOST-A's entry is learned on ge-0/0/1 from the real frame, then on ${P} and ${S2} as looped copies with the same source MAC arrive`}>
      <text x={20} y={24} fill={D.text} fontSize={10.5} fontWeight={700}>
        SW1&apos;s entry for HOST-A over time (same source MAC every time)
      </text>
      {steps.map((st, i) => (
        <g key={i}>
          <DNode x={85 + i * 155} y={80} label={st.port} sub={st.why} accent={st.c} w={130} h={48} />
          {i < steps.length - 1 && <DArrow x1={152 + i * 155} y1={80} x2={173 + i * 155} y2={80} color={D.muted} width={1.6} />}
        </g>
      ))}
      <text x={20} y={140} fill={D.muted} fontSize={10}>
        Source learning is working exactly as designed — the loop keeps delivering the same source on new ports.
      </text>
      <text x={20} y={158} fill={D.muted} fontSize={10}>
        Many switches log this as a &quot;MAC move&quot; or &quot;MAC flap&quot; warning: a strong hint of a Layer-2 loop.
      </text>
    </DiagramSvg>
  );
}

function PreventionDiagram() {
  return (
    <DiagramSvg h={250} label={`Loop prevention concept: both SW1 to SW2 links stay cabled for redundancy, but a loop-prevention protocol keeps only one forwarding and holds the other in a non-forwarding state until it is needed`}>
      <TwoSwitches primary="both" secondary="down" subs={{ SW1: "redundant", SW2: "redundant" }}>
        <SwNote sw="SW1" dy={-44} text={`${P.slice(-2)}: forwarding`} color={D.success} />
        <SwNote sw="SW2" dy={-44} text={`${S2.slice(-2)}: held non-forwarding`} color={D.warning} />
      </TwoSwitches>
      <text x={320} y={242} textAnchor="middle" fill={D.muted} fontSize={10}>
        Keep the cable, keep the redundancy — let a protocol decide which link forwards (STP, a later lesson).
      </text>
    </DiagramSvg>
  );
}

export function SwitchingDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="swd-terms" eyebrow="Terminology" title="Bridge or switch?" tone="ethernet">
        <p>
          IEEE 802.1D calls the device a <strong>bridge</strong>: it joins LAN segments and forwards frames by MAC address. A modern Ethernet <strong>switch</strong> is a multiport bridge that does this in hardware on every port. Everything in this lesson — learning, flooding, filtering — is bridge behaviour.
        </p>
      </GuideSection>

      <GuideSection id="swd-pipeline" eyebrow="Inside a bridge" title="The same pipeline, every switch, every frame" tone="cyan">
        <DiagramFrame caption="Five steps per frame per bridge.">
          <PipelineDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="swd-views" eyebrow="Local vs remote" title="Each switch sees the LAN from where it stands" tone="violet">
        <DiagramFrame caption="Entries for hosts on the far switch all point at the inter-switch port.">
          <ViewsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="swd-partial" eyebrow="Partial knowledge" title="Known here, unknown there" tone="warning">
        <DiagramFrame caption="SW2 never received a frame from HOST-D, so its lookup misses; SW1's hits.">
          <PartialDiagram />
        </DiagramFrame>
        <p>This is normal, not a fault: tables fill independently, from whatever traffic happens to cross each switch. A frame for a silent host may be flooded at one switch and forwarded precisely at the next.</p>
      </GuideSection>

      <GuideSection id="swd-domains" eyebrow="Domains" title="Collision domains vs the broadcast domain" tone="arp">
        <DiagramFrame caption="Full-duplex switched Ethernet: every link is its own collision domain; the whole LAN is one broadcast domain.">
          <DomainsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="swd-modes" eyebrow="Forwarding modes" title="Store-and-forward vs cut-through" tone="cyan">
        <CompareCards
          items={[
            { title: "Store-and-forward", tone: "cyan", tag: "common", points: ["Receives the whole frame first", "Checks the FCS; drops corrupted frames", "Latency grows with frame size"] },
            { title: "Cut-through", tone: "violet", tag: "optional", points: ["Starts sending once the destination MAC is read", "Lower latency", "May forward a frame whose FCS later fails"] },
          ]}
        />
        <p>Either way the forwarding decision is the same FDB lookup. The mode changes timing, not where the frame goes.</p>
      </GuideSection>

      <GuideSection id="swd-loops" eyebrow="Forwarding loops" title="Why a ring of active links never drains" tone="danger">
        <DiagramFrame caption="Any closed path of forwarding links between bridges is a loop.">
          <LoopGeneralDiagram />
        </DiagramFrame>
        <Callout tone="danger" title="No TTL at Layer 2">
          An Ethernet header is destination, source and EtherType. There is no hop count for a switch to decrement, so a looping broadcast or unknown-unicast frame circulates until the loop is broken. In the lesson&apos;s two-link case the same two copies keep circling. Every pass re-delivers the broadcast to every host, and every NEW flooded frame adds more copies. That is a <strong>broadcast storm</strong>.
        </Callout>
      </GuideSection>

      <GuideSection id="swd-flap" eyebrow="MAC flapping" title="The entry follows the looped source" tone="warning">
        <DiagramFrame caption="One MAC, four ports in a row — without the host ever moving.">
          <FlapDiagram />
        </DiagramFrame>
        <p>
          Flapping also breaks unicast. Once HOST-A&apos;s entry points at <Mono>{S2}</Mono>, SW1 sends HOST-D&apos;s unicast frames for HOST-A toward SW2 instead of out ge-0/0/1.
        </p>
      </GuideSection>

      <GuideSection id="swd-prevention" eyebrow="Loop prevention" title="Redundancy without loops" tone="success">
        <DiagramFrame caption="Concept only: one link forwards, the redundant one waits.">
          <PreventionDiagram />
        </DiagramFrame>
        <p>The standard class of mechanism is the Spanning Tree Protocol family. It detects redundant paths and keeps a loop-free set of links forwarding, re-enabling a blocked link if the active one fails. How it elects and blocks is its own lesson. Without it, the only safe design is exactly one active path between any two switches, which is what the repair restored.</p>
      </GuideSection>

      <GuideSection id="swd-workflow" eyebrow="Workflow" title="Troubleshooting a multi-switch LAN" tone="danger">
        <FlowSteps
          steps={[
            { title: "Is it one switch or several?", body: "Check each switch's own FDB for the destination: known, unknown, or on an unexpected port?", tone: "cyan" },
            { title: "Follow the lookups", body: "Walk the path switch by switch; each hop is a separate lookup.", tone: "violet" },
            { title: "Look for loop symptoms", body: "Rising broadcast counters, duplicate delivery, MAC-move warnings, sudden CPU/link saturation.", tone: "warning" },
            { title: "Count the active paths", body: "Between any two switches, how many links forward? With no loop prevention, it must be one.", tone: "danger" },
            { title: "Break the loop, then verify", body: "Disable the extra path; confirm single delivery and stable entries.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="swd-verify" eyebrow="Verification" title="What healthy looks like" tone="success">
        <ChecklistCard tone="success" title="Healthy multi-switch LAN" mark="✓" items={[`A broadcast (${BROADCAST_MAC}) arrives once per host`, "Each host's MAC sits on one stable port per switch", "Known unicast leaves exactly one port at every switch", "No MAC-move warnings; broadcast counters flat"]} />
      </GuideSection>

      <GuideSection id="swd-model" eyebrow="Mental model" title="Independent bridges, shared broadcast domain" tone="violet">
        <p>Every switch is independent in what it knows and shared in what it floods. Knowledge is local and learned from sources. Floods travel the whole domain. Loops turn that domain-wide reach into endless copies.</p>
      </GuideSection>

      <GuideSection id="swd-glossary" eyebrow="Glossary" title="Deep-dive terms" tone="cyan">
        <Glossary
          items={[
            { term: "Transparent bridge", def: "A bridge hosts don't need to know about; it learns and forwards on its own (IEEE 802.1D)." },
            { term: "Collision domain", def: "Where two transmissions can collide; each full-duplex switch link is its own." },
            { term: "Broadcast domain", def: "All hosts a broadcast reaches; bounded by routers or VLANs." },
            { term: "Broadcast storm", def: "Looping flooded frames consuming links and CPUs." },
            { term: "MAC move / flap", def: "One source MAC seen on changing ports; a loop symptom." },
            { term: "STP", def: "Spanning Tree Protocol family: keeps redundant Layer-2 topologies loop-free (later lesson)." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
