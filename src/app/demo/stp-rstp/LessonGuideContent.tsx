import { Callout, ChecklistCard, CompareCards, DIAGRAM as D, DiagramFrame, DiagramSvg, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { BPDU_DST, BRIDGES, LINK_COST, bidText } from "@/lib/sim-engine/scenarios/stpRstp";
import { Triangle } from "./guideSvg";

export const STP_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "stl-mission", label: "The mission" },
  { id: "stl-triangle", label: "The triangle" },
  { id: "stl-claims", label: "Self-root claims" },
  { id: "stl-root", label: "Root election" },
  { id: "stl-rp", label: "Root Ports" },
  { id: "stl-dp", label: "Designated vs Alternate" },
  { id: "stl-tree", label: "The final tree" },
  { id: "stl-data", label: "Customer data path" },
  { id: "stl-fail", label: "Failure & takeover" },
  { id: "stl-incident", label: "The incident" },
  { id: "stl-repair", label: "Repair & verify" },
  { id: "stl-compare", label: "RSTP vs LACP" },
  { id: "stl-model", label: "Mental model" },
  { id: "stl-glossary", label: "Glossary" },
  { id: "stl-recap", label: "Recap" },
];

const C = LINK_COST;
const healthyEnds = { L12: ["DP FWD", "RP FWD"] as [string, string], L13: ["DP FWD", "RP FWD"] as [string, string], L23: ["DP FWD", "ALT DISC"] as [string, string] };

function TriangleBefore() {
  return (
    <DiagramSvg h={240} label="Three bridges cabled in a triangle, all links physically up; before convergence every inter-switch port is Designated and Discarding">
      <Triangle modes={{ L12: "idle", L13: "idle", L23: "idle" }} ends={{ L12: ["DP DISC", "DP DISC"], L13: ["DP DISC", "DP DISC"], L23: ["DP DISC", "DP DISC"] }} subs={{ SW1: "24576", SW2: "32768", SW3: "32768" }} />
      <text x={320} y={232} textAnchor="middle" fill={D.muted} fontSize={10}>
        Every cable up · a physical loop · nothing forwards customer data yet
      </text>
    </DiagramSvg>
  );
}

function ClaimsDiagram() {
  return (
    <DiagramSvg h={240} label="Each bridge first advertises itself as root with Root Path Cost 0; BPDUs cross every inter-switch link">
      <Triangle modes={{ L12: "claim", L13: "claim", L23: "claim" }} subs={{ SW1: "root = me", SW2: "root = me", SW3: "root = me" }} />
      <text x={320} y={232} textAnchor="middle" fill={D.muted} fontSize={10}>
        {`BPDUs to ${BPDU_DST} — Root ID = own Bridge ID, cost 0 — until something better arrives`}
      </text>
    </DiagramSvg>
  );
}

function ElectionDiagram() {
  return (
    <DiagramSvg h={170} label="Root election: SW1 priority 24576 beats 32768 on SW2 and SW3; MAC only breaks ties between equal priorities">
      <DTable
        x={60}
        y={8}
        title="Bridge IDs — priority first, MAC only as a tie-break"
        cols={[
          { label: "BRIDGE", w: 80 },
          { label: "PRIORITY", w: 100 },
          { label: "MAC", w: 170 },
          { label: "RESULT", w: 170 },
        ]}
        rows={[
          ["SW1", String(BRIDGES.SW1.priority), BRIDGES.SW1.mac, "lowest → ROOT"],
          ["SW2", String(BRIDGES.SW2.priority), BRIDGES.SW2.mac, "not root"],
          ["SW3", String(BRIDGES.SW3.priority), BRIDGES.SW3.mac, "not root"],
        ]}
        highlight={{ row: 0, color: D.success }}
      />
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        24576 &lt; 32768 decides it. SW2 vs SW3 (equal 32768) would fall to the MAC: :02 &lt; :03.
      </text>
    </DiagramSvg>
  );
}

function RootPortDiagram() {
  return (
    <DiagramSvg h={240} label={`Root Ports: SW2 ge-0/0/1 and SW3 ge-0/0/1 face SW1 directly with Root Path Cost ${C}; the root SW1 has no Root Port`}>
      <Triangle modes={{ L12: "ba", L13: "ba", L23: "idle" }} ends={{ L12: ["DP", "RP"], L13: ["DP", "RP"] }} subs={{ SW1: "ROOT · no RP", SW2: `RP ge-0/0/1 · ${C}`, SW3: `RP ge-0/0/1 · ${C}` }} />
      <text x={320} y={232} textAnchor="middle" fill={D.muted} fontSize={10}>
        {`Arrows point toward the root. Direct = ${C}; via the other bridge = ${C * 2}.`}
      </text>
    </DiagramSvg>
  );
}

function DesignatedDiagram() {
  return (
    <DiagramSvg h={200} label={`SW2-SW3 segment: both advertise Root SW1 cost ${C}; the lower sender Bridge ID (SW2) wins the Designated port; SW3's end becomes Alternate`}>
      <DTable
        x={20}
        y={8}
        title="What each side advertises on the SW2–SW3 segment"
        cols={[
          { label: "SENDER", w: 76 },
          { label: "ROOT ID", w: 150 },
          { label: "COST", w: 70 },
          { label: "BRIDGE ID", w: 190 },
          { label: "PORT", w: 114 },
        ]}
        rows={[
          ["SW2", `SW1 ${BRIDGES.SW1.priority}`, String(C), bidText(BRIDGES.SW2), "Designated"],
          ["SW3", `SW1 ${BRIDGES.SW1.priority}`, String(C), bidText(BRIDGES.SW3), "Alternate"],
        ]}
        highlight={{ row: 0, color: D.success }}
      />
      <text x={20} y={130} fill={D.text} fontSize={10.5} fontWeight={700}>
        Root ID ties · Root Path Cost ties · sender Bridge ID: SW2 (…:02) &lt; SW3 (…:03)
      </text>
      <text x={20} y={150} fill={D.muted} fontSize={10}>
        SW3&apos;s ge-0/0/2 hears better information than it would send and it isn&apos;t SW3&apos;s Root Port:
      </text>
      <text x={20} y={168} fill={D.muted} fontSize={10}>
        it becomes Alternate — a ready backup path to the root, held Discarding.
      </text>
    </DiagramSvg>
  );
}

function TreeDiagram() {
  return (
    <DiagramSvg h={240} label="Final loop-free tree: SW1 to SW2 and SW1 to SW3 forward; SW2's cross-link port is Designated Forwarding; SW3's is Alternate Discarding; all links physically up">
      <Triangle modes={{ L12: "fwd", L13: "fwd", L23: "alt" }} ends={healthyEnds} subs={{ SW1: "ROOT", SW2: `cost ${C}`, SW3: `cost ${C}` }} />
      <text x={320} y={232} textAnchor="middle" fill={D.muted} fontSize={10}>
        Three cables up · one port Discarding · no loop in the forwarding topology
      </text>
    </DiagramSvg>
  );
}

function DataPathDiagram() {
  return (
    <DiagramSvg h={240} label="Customer data from HOST-B to HOST-C goes SW2 to SW1 to SW3, not across the SW2-SW3 cable, while SW3's end is Alternate Discarding">
      <Triangle modes={{ L12: "ba", L13: "ab", L23: "alt" }} ends={{ L23: ["DP FWD", "ALT DISC"] }} hostLinks={{ B: "in", C: "out" }} subs={{ SW1: "transit", SW2: "C → ge-0/0/1", SW3: "C → edge" }} />
      <text x={320} y={232} textAnchor="middle" fill={D.muted} fontSize={10}>
        HOST-B → SW2 → SW1 → SW3 → HOST-C · BPDUs still use SW2–SW3; customer data does not
      </text>
    </DiagramSvg>
  );
}

function FailoverDiagram() {
  return (
    <DiagramSvg h={240} label={`SW1-SW3 fails; SW3's former Alternate port becomes Root with cost ${C * 2} and forwards after RSTP reconverges; HOST-B to HOST-C now uses SW2-SW3`}>
      <Triangle modes={{ L12: "fwd", L13: "down", L23: "fwd" }} ends={{ L12: ["DP FWD", "RP FWD"], L13: ["DOWN", "DOWN"], L23: ["DP FWD", "RP FWD"] }} subs={{ SW1: "ROOT", SW2: `cost ${C}`, SW3: `RP ge-0/0/2 · ${C * 2}` }} />
      <text x={320} y={232} textAnchor="middle" fill={D.muted} fontSize={10}>
        {`Alternate → Root after RSTP reconvergence · path SW3 → SW2 → SW1 = ${C} + ${C}`}
      </text>
    </DiagramSvg>
  );
}

function IncidentDiagram() {
  return (
    <DiagramSvg h={240} label="Incident: RSTP participation disabled on SW3's SW2-facing port, which is forced to forward; all three links forward customer data and broadcasts circulate">
      <Triangle modes={{ L12: "loop", L13: "loop", L23: "loop" }} ends={{ L12: ["DP FWD", "RP FWD"], L13: ["DP FWD", "RP FWD"], L23: ["DP FWD", "RSTP OFF"] }} subs={{ SW1: "ROOT", SW2: "A flaps", SW3: "A flaps" }} />
      <text x={320} y={232} textAnchor="middle" fill={D.danger} fontSize={10} fontWeight={700}>
        Unsafe teaching misconfiguration: no port left Discarding → the triangle loops again
      </text>
    </DiagramSvg>
  );
}

function RepairDiagram() {
  return (
    <DiagramSvg h={240} label="Repair: RSTP participation restored on SW3 ge-0/0/2; it processes SW2's BPDU and returns to Alternate Discarding; each host receives a broadcast once">
      <Triangle modes={{ L12: "fwd", L13: "fwd", L23: "alt" }} ends={healthyEnds} subs={{ SW1: "ROOT", SW2: "1 copy to B", SW3: "1 copy to C" }} />
      <text x={320} y={232} textAnchor="middle" fill={D.muted} fontSize={10}>
        RSTP back on the port → Alternate/Discarding after reconvergence → loop-free again
      </text>
    </DiagramSvg>
  );
}

export function StpLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="stl-mission" eyebrow="This lesson" title="Keep every cable, lose the loop" tone="ethernet">
        <p>
          In Switching Fundamentals a second active cable between two switches made broadcasts circulate forever, and the fix was to disable it. Real networks want that redundancy. RSTP keeps every cable up and lets the bridges agree, with BPDUs, on a loop-free set of <strong>forwarding</strong> ports.
        </p>
        <Callout tone="ethernet" title="The one rule to remember">
          Lowest Bridge ID is root. Every other bridge keeps exactly one Root Port toward it. On every segment one Designated port forwards, and any other port on a loop is held Alternate/Discarding.
        </Callout>
      </GuideSection>

      <GuideSection id="stl-triangle" eyebrow="Topology" title="A triangle is a loop" tone="cyan">
        <DiagramFrame caption="Before any BPDU is compared: all ports Designated, all Discarding.">
          <TriangleBefore />
        </DiagramFrame>
        <p>
          Each link has the scenario&apos;s configured RSTP path cost <Mono>{String(C)}</Mono>. Host ports are edge ports: they forward immediately and don&apos;t take part in the loop decision.
        </p>
      </GuideSection>

      <GuideSection id="stl-claims" eyebrow="Start" title="Everyone claims root" tone="violet">
        <DiagramFrame caption="Each bridge's first BPDUs name itself as root.">
          <ClaimsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="stl-root" eyebrow="Root election" title="Lowest Bridge ID wins" tone="success">
        <DiagramFrame caption="Priority is compared before the MAC.">
          <ElectionDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="stl-rp" eyebrow="Root Ports" title="One best path toward the root" tone="ip">
        <DiagramFrame caption="Root Ports face the root; the root itself has none.">
          <RootPortDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="stl-dp" eyebrow="Designated / Alternate" title="The tie on SW2–SW3" tone="warning">
        <DiagramFrame caption="Priority vectors compared field by field: Root ID, cost, sender Bridge ID, sender Port ID.">
          <DesignatedDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="stl-tree" eyebrow="Result" title="The loop-free tree" tone="success">
        <DiagramFrame caption="Root and Designated ports forward after RSTP synchronization; the Alternate port discards.">
          <TreeDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Discarding is not down">
          SW3&apos;s ge-0/0/2 is physically up and keeps receiving BPDUs from SW2. RSTP only keeps customer frames off it: they are neither forwarded nor learned there.
        </Callout>
      </GuideSection>

      <GuideSection id="stl-data" eyebrow="Data plane" title="Where customer frames actually go" tone="ip">
        <DiagramFrame caption="Control plane and data plane use different paths across SW2–SW3.">
          <DataPathDiagram />
        </DiagramFrame>
        <p>SW2&apos;s Designated port does transmit floods onto the cross-link, but SW3 drops them on its Alternate port. That drop is what stops a broadcast going round the triangle.</p>
      </GuideSection>

      <GuideSection id="stl-fail" eyebrow="Redundancy" title="Failure and Alternate takeover" tone="danger">
        <DiagramFrame caption="The pre-computed backup becomes the Root Port.">
          <FailoverDiagram />
        </DiagramFrame>
        <p>The topology change also flushes MAC entries learned on non-edge ports, so switches relearn over the new tree. When SW1–SW3 comes back, SW3&apos;s direct path wins again and, after RSTP reconverges, ge-0/0/2 returns to Alternate/Discarding.</p>
      </GuideSection>

      <GuideSection id="stl-incident" eyebrow="Incident" title="A port taken out of RSTP" tone="danger">
        <DiagramFrame caption="RSTP can only protect ports that participate in it.">
          <IncidentDiagram />
        </DiagramFrame>
        <p>With RSTP disabled on SW3&apos;s cross-link port and the port forced to forward, SW2&apos;s BPDUs no longer steer it into Alternate. All three links carry customer data, and a single broadcast circulates in both directions round the triangle. This is an intentionally unsafe misconfiguration; it is not how edge ports behave.</p>
      </GuideSection>

      <GuideSection id="stl-repair" eyebrow="Repair" title="Restore RSTP participation, then verify" tone="success">
        <DiagramFrame caption="The same tree as before the incident.">
          <RepairDiagram />
        </DiagramFrame>
        <ChecklistCard tone="success" title="Verified" mark="✓" items={["SW3 ge-0/0/2: RSTP enabled, Alternate / Discarding (link still up)", "SW2 ge-0/0/2: Designated / Forwarding", "A new broadcast reaches each host exactly once", "No copies left circulating"]} />
        <p>Clearing MAC tables, touching IPv4 TTLs, unplugging HOST-C or changing a MAC doesn&apos;t put a port back under RSTP&apos;s control.</p>
      </GuideSection>

      <GuideSection id="stl-compare" eyebrow="Comparison" title="RSTP and LACP solve different problems" tone="violet">
        <CompareCards
          items={[
            { title: "STP / RSTP", tone: "ethernet", tag: "loop-free", points: ["Problem: a redundant Layer-2 topology can loop", "Selects a loop-free logical topology", "Some redundant links carry no customer data until needed", "Does not add bandwidth"] },
            { title: "LACP (next lesson)", tone: "cyan", tag: "one logical link", points: ["Problem: parallel links should act as ONE link", "Negotiates compatible members into one LAG", "All healthy members can forward at once", "STP then sees the LAG as a single path"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="stl-model" eyebrow="Mental model" title="Everyone points at the root" tone="violet">
        <p>Imagine every bridge pointing at the root along its cheapest path, like water running downhill to one drain. Links used by those arrows form the tree. A link no arrow uses would create a second route between two points, so one end of it keeps its door closed. If a pipe breaks, the water finds the next-cheapest way down, through that closed door.</p>
      </GuideSection>

      <GuideSection id="stl-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <Glossary
          items={[
            { term: "Bridge ID", def: "Priority, then MAC. Lowest becomes root." },
            { term: "Root Path Cost", def: "Sum of configured port costs to the root." },
            { term: "Root Port", def: "A non-root bridge's best port toward the root." },
            { term: "Designated Port", def: "The port that forwards for a segment; best advertised vector." },
            { term: "Alternate Port", def: "A backup path to the root; Discarding." },
            { term: "Discarding", def: "RSTP state: no customer forwarding, no learning, BPDUs still processed." },
          ]}
        />
      </GuideSection>

      <GuideSection id="stl-recap" eyebrow="Recap" title="What you saw" tone="success">
        <FlowSteps
          steps={[
            { title: "Elect", body: "Lowest Bridge ID (priority first) became root.", tone: "violet" },
            { title: "Choose", body: "Root Ports on SW2 and SW3; SW2 won the Designated port on SW2–SW3; SW3's end became Alternate.", tone: "ip" },
            { title: "Forward", body: "Only Root and Designated ports forwarded customer data.", tone: "success" },
            { title: "Recover", body: "When SW1–SW3 failed, the Alternate took over after RSTP reconverged.", tone: "warning" },
            { title: "Protect", body: "A port taken out of RSTP broke loop prevention; restoring participation fixed it.", tone: "danger" },
          ]}
        />
      </GuideSection>
    </div>
  );
}
