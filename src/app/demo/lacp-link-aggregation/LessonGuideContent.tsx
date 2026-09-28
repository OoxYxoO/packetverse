import { Callout, ChecklistCard, CompareCards, DIAGRAM as D, DiagramFrame, DiagramSvg, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { HOST_IP, LACP_DST, LACP_ETHERTYPE, LAG1_KEY, LAG_NAME, SYSTEMS } from "@/lib/sim-engine/scenarios/lacpLinkAggregation";
import { LagPair } from "./guideSvg";

export const LACP_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "lcl-mission", label: "The mission" },
  { id: "lcl-before", label: "Two separate links" },
  { id: "lcl-pdus", label: "LACPDU exchange" },
  { id: "lcl-actor", label: "Actor / Partner" },
  { id: "lcl-states", label: "Member states" },
  { id: "lcl-lag", label: "The logical LAG" },
  { id: "lcl-flows", label: "Two flows" },
  { id: "lcl-fail", label: "Member failure" },
  { id: "lcl-restore", label: "Restoration" },
  { id: "lcl-mismatch", label: "Key mismatch" },
  { id: "lcl-repair", label: "Repair & verify" },
  { id: "lcl-compare", label: "LACP vs STP" },
  { id: "lcl-model", label: "Mental model" },
  { id: "lcl-glossary", label: "Glossary" },
  { id: "lcl-recap", label: "Recap" },
];

const K1 = LAG1_KEY.SW1;
const K2 = LAG1_KEY.SW2;

function BeforeDiagram() {
  return (
    <DiagramSvg h={220} label="Before bundling: two independent links between SW1 and SW2 form a Layer-2 loop; spanning tree would have to hold one of them Discarding">
      <LagPair m23="idle" m24="idle" labels={{ m23: "ge-0/0/23 · separate link", m24: "ge-0/0/24 · separate link" }} subs={{ SW1: "2 ports", SW2: "2 ports" }} />
      <text x={320} y={210} textAnchor="middle" fill={D.muted} fontSize={10}>
        As two independent paths they form a loop — spanning tree would block one of them.
      </text>
    </DiagramSvg>
  );
}

function PduDiagram() {
  return (
    <DiagramSvg h={220} label={`LACPDUs to ${LACP_DST} with EtherType ${LACP_ETHERTYPE} are exchanged separately on each member; they are link-local and never forwarded`}>
      <LagPair m23="both" m24="both" labels={{ m23: "LACPDUs on ge-0/0/23", m24: "LACPDUs on ge-0/0/24" }} subs={{ SW1: "Active", SW2: "Active" }} />
      <text x={320} y={210} textAnchor="middle" fill={D.muted} fontSize={10}>
        {`Destination ${LACP_DST} · EtherType ${LACP_ETHERTYPE} · subtype 0x01 · one conversation per member`}
      </text>
    </DiagramSvg>
  );
}

function ActorPartnerDiagram() {
  return (
    <DiagramSvg h={170} label={`Actor and Partner as SW1 sees ge-0/0/23: Actor is SW1 itself with key ${K1}; Partner is what SW2 said about itself, key ${K2}`}>
      <DTable
        x={30}
        y={8}
        title="On SW1 ge-0/0/23 — whose fields are these?"
        cols={[
          { label: "", w: 90 },
          { label: "SYSTEM", w: 200 },
          { label: "KEY", w: 60 },
          { label: "PORT", w: 60 },
          { label: "STATE", w: 170 },
        ]}
        rows={[
          ["Actor", `SW1 ${SYSTEMS.SW1.priority} / …:53:11`, String(K1), "23", "0x3D"],
          ["Partner", `SW2 ${SYSTEMS.SW2.priority} / …:53:22`, String(K2), "23", "0x3D"],
        ]}
      />
      <text x={30} y={120} fill={D.text} fontSize={10.5} fontWeight={700}>
        Actor = what SW1 says about itself. Partner = what SW1 has learned from SW2&apos;s LACPDUs.
      </text>
      <text x={30} y={140} fill={D.muted} fontSize={10}>
        On SW2 the same member shows the mirror image: Actor SW2 (key {K2}), Partner SW1 (key {K1}).
      </text>
      <text x={30} y={158} fill={D.muted} fontSize={10}>
        The keys differ between systems — and that is fine.
      </text>
    </DiagramSvg>
  );
}

function StatesDiagram() {
  return (
    <DiagramSvg h={200} label="Member state bytes during negotiation: 0x45 defaulted, 0x0D synchronized, 0x1D collecting, 0x3D collecting and distributing">
      <DTable
        x={20}
        y={8}
        title="One member, from link-up to carrying traffic"
        cols={[
          { label: "STATE BYTE", w: 100 },
          { label: "FLAGS SET", w: 330 },
          { label: "CUSTOMER DATA?", w: 170 },
        ]}
        rows={[
          ["0x45", "Activity · Aggregation · Defaulted", "no — partner unknown"],
          ["0x0D", "Activity · Aggregation · Synchronization", "no"],
          ["0x1D", "… · Synchronization · Collecting", "receive only"],
          ["0x3D", "… · Synchronization · Collecting · Distributing", "yes — eligible"],
        ]}
        highlight={{ row: 3, color: D.success }}
        rowH={24}
      />
      <text x={20} y={170} fill={D.muted} fontSize={10}>
        Long timeout throughout (Timeout bit 0). Distributing needs the partner to be Collecting first.
      </text>
    </DiagramSvg>
  );
}

function LogicalDiagram() {
  return (
    <DiagramSvg h={220} label="LAG1: both members distributing; the MAC table, spanning tree and VLAN trunking see one logical port">
      <LagPair m23="dist" m24="dist" labels={{ m23: "ge-0/0/23 DIST", m24: "ge-0/0/24 DIST" }} lag={`${LAG_NAME} — one logical port on each switch`} subs={{ SW1: `key ${K1}`, SW2: `key ${K2}` }} />
      <text x={320} y={210} textAnchor="middle" fill={D.muted} fontSize={10}>
        Above LACP: one port, one path. Below it: two physical members.
      </text>
    </DiagramSvg>
  );
}

function FlowsDiagram() {
  return (
    <DiagramSvg h={230} label={`Two flows on two members: Flow 1 HOST-A to HOST-B on ge-0/0/23, Flow 2 HOST-A to HOST-C on ge-0/0/24, chosen by the PacketVerse modeled hash`}>
      <LagPair m23="flow" m24="flow" labels={{ m23: "Flow 1 → HOST-B", m24: "Flow 2 → HOST-C" }} lag={LAG_NAME} hosts={{ A: "in", B: "out", C: "out" }} />
      <text x={320} y={206} textAnchor="middle" fill={D.text} fontSize={10}>
        {`PacketVerse modeled hash: (src + dst last octet) mod 2 — F1 (${HOST_IP["HOST-A"].split(".")[3]} + ${HOST_IP["HOST-B"].split(".")[3]}) → 23 · F2 (${HOST_IP["HOST-A"].split(".")[3]} + ${HOST_IP["HOST-C"].split(".")[3]}) → 24`}
      </text>
      <text x={320} y={222} textAnchor="middle" fill={D.muted} fontSize={10}>
        Real platforms use their own hash inputs. Each flow stays on one member.
      </text>
    </DiagramSvg>
  );
}

function FailDiagram() {
  return (
    <DiagramSvg h={220} label="ge-0/0/23 fails: it stops collecting and distributing; LAG1 stays up on ge-0/0/24 with reduced capacity and both flows now use ge-0/0/24">
      <LagPair m23="down" m24="flow" labels={{ m23: "ge-0/0/23 DOWN", m24: "Flow 1 + Flow 2" }} lag={`${LAG_NAME} up · 1 member`} hosts={{ A: "in", B: "out", C: "out" }} />
      <text x={320} y={210} textAnchor="middle" fill={D.muted} fontSize={10}>
        The surviving member keeps the LAG up: less capacity, no redundancy — not an outage.
      </text>
    </DiagramSvg>
  );
}

function RestoreDiagram() {
  return (
    <DiagramSvg h={220} label="Restoring ge-0/0/23: link up, LACPDUs, synchronization, collecting, distributing — only then eligible again">
      <LagPair m23="neg" m24="dist" labels={{ m23: "0x45 → 0x0D → 0x1D → 0x3D", m24: "ge-0/0/24 DIST" }} lag={`${LAG_NAME}`} />
      <text x={320} y={210} textAnchor="middle" fill={D.muted} fontSize={10}>
        Link up ≠ in use. The member carries customer data only after it is Distributing again.
      </text>
    </DiagramSvg>
  );
}

function MismatchDiagram() {
  return (
    <DiagramSvg h={220} label="Key mismatch: SW2 ge-0/0/24 key 99 while SW2's other LAG1 member uses 20; the member leaves LAG1 on both ends while ge-0/0/23 keeps working">
      <LagPair m23="dist" m24="out" labels={{ m23: "ge-0/0/23 DIST", m24: "ge-0/0/24 up · not in LAG1" }} lag={`${LAG_NAME} up · 1 member`} subs={{ SW1: "partner 20 ≠ 99", SW2: "keys 20 / 99" }} />
      <text x={320} y={210} textAnchor="middle" fill={D.danger} fontSize={10} fontWeight={700}>
        SW2&apos;s own members disagree (20 vs 99) — not &quot;SW2&apos;s key must equal SW1&apos;s&quot;.
      </text>
    </DiagramSvg>
  );
}

function RepairDiagram() {
  return (
    <DiagramSvg h={220} label="Repair: SW2 ge-0/0/24 key back to 20; LACP renegotiates and both members distribute again">
      <LagPair m23="dist" m24="dist" labels={{ m23: "ge-0/0/23 DIST", m24: "ge-0/0/24 key 20 → DIST" }} lag={`${LAG_NAME} up · 2 members`} subs={{ SW1: `key ${K1} / ${K1}`, SW2: `key ${K2} / ${K2}` }} />
      <text x={320} y={210} textAnchor="middle" fill={D.muted} fontSize={10}>
        Consistent keys on each switch → reselected → Synchronization, Collecting, Distributing.
      </text>
    </DiagramSvg>
  );
}

export function LacpLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="lcl-mission" eyebrow="This lesson" title="Many cables, one link" tone="ethernet">
        <p>
          Two cables between the same two switches can carry twice the traffic and survive a cable failure, but only if the switches treat them as <strong>one</strong> logical link. LACP (IEEE 802.1AX) is how the two ends agree which physical members belong in that bundle and when each member may carry traffic.
        </p>
        <Callout tone="ethernet" title="The one rule to remember">
          LACP decides which members are eligible. The forwarding system decides which eligible member each flow uses.
        </Callout>
      </GuideSection>

      <GuideSection id="lcl-before" eyebrow="Before" title="Two separate links are a loop" tone="cyan">
        <DiagramFrame caption="Without aggregation, spanning tree would have to keep one cable non-forwarding.">
          <BeforeDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lcl-pdus" eyebrow="Control plane" title="LACPDUs on every member" tone="violet">
        <DiagramFrame caption="Slow Protocol frames, one exchange per member.">
          <PduDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lcl-actor" eyebrow="Actor / Partner" title="Who is saying what" tone="ip">
        <DiagramFrame caption="Each LACPDU carries the sender's Actor fields and what it has learned as Partner.">
          <ActorPartnerDiagram />
        </DiagramFrame>
        <p>
          A system identity is a System Priority plus a System ID (a MAC), e.g. <Mono>{`${SYSTEMS.SW1.priority} / ${SYSTEMS.SW1.mac}`}</Mono>. It names the whole switch in LACP. It is not the source MAC of customer frames.
        </p>
      </GuideSection>

      <GuideSection id="lcl-states" eyebrow="Member states" title="From link-up to Distributing" tone="success">
        <DiagramFrame caption="Each step needs the partner to have reached the step before.">
          <StatesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lcl-lag" eyebrow="Aggregation" title="The logical LAG" tone="cyan">
        <DiagramFrame caption="Both members distributing; one logical port above them.">
          <LogicalDiagram />
        </DiagramFrame>
        <p>SW2 learns HOST-A behind <Mono>{LAG_NAME}</Mono>, not behind ge-0/0/23 or ge-0/0/24. Spanning tree also sees one path, so it has no reason to block a member.</p>
      </GuideSection>

      <GuideSection id="lcl-flows" eyebrow="Data plane" title="Two flows, two members" tone="ip">
        <DiagramFrame caption="Per-flow pinning: one flow, one member; many flows spread out.">
          <FlowsDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Not double speed for one flow">
          A single flow stays on one member so its packets don&apos;t get reordered. A two-member LAG raises total capacity across many flows. It does not stripe one flow over both members.
        </Callout>
      </GuideSection>

      <GuideSection id="lcl-fail" eyebrow="Failure" title="One member down, LAG still up" tone="danger">
        <DiagramFrame caption="Flow 1 is re-hashed onto the surviving member.">
          <FailDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lcl-restore" eyebrow="Recovery" title="Bringing a member back" tone="warning">
        <DiagramFrame caption="Renegotiate first, distribute second.">
          <RestoreDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lcl-mismatch" eyebrow="Incident" title="A key that doesn't fit" tone="danger">
        <DiagramFrame caption="Both cables up, LACPDUs flowing — one member still out.">
          <MismatchDiagram />
        </DiagramFrame>
        <p>
          SW1 uses key {K1} and SW2 uses key {K2}, and that never mattered. When SW2 ge-0/0/24 was moved to key 99, SW2&apos;s two candidate ports stopped sharing one local key, so they can&apos;t sit in the same aggregator. SW1 also sees two different partner keys across its members (20 and 99). ge-0/0/24 leaves LAG1 on both ends, and ge-0/0/23 keeps LAG1 up.
        </p>
      </GuideSection>

      <GuideSection id="lcl-repair" eyebrow="Repair" title="Make SW2's keys consistent again" tone="success">
        <DiagramFrame caption="Key 20 on both SW2 members, then a fresh negotiation.">
          <RepairDiagram />
        </DiagramFrame>
        <ChecklistCard tone="success" title="Verified" mark="✓" items={["SW2 ge-0/0/24 key 20 again", "ge-0/0/24: Synchronization, Collecting and Distributing on both ends", `${LAG_NAME} up with 2 members`, "Flow 1 on ge-0/0/23, Flow 2 on ge-0/0/24 again"]} />
        <p>Changing SW1&apos;s key to 20, clearing MAC tables, touching spanning-tree priority or shutting the healthy member would not fix SW2&apos;s inconsistent member.</p>
      </GuideSection>

      <GuideSection id="lcl-compare" eyebrow="Comparison" title="LACP and STP work together" tone="violet">
        <CompareCards
          items={[
            { title: "LACP", tone: "cyan", tag: "one logical link", points: ["Parallel links between the SAME two devices", "Negotiates compatible members into one LAG", "All healthy members forward at once", "Handles member health and eligibility"] },
            { title: "STP / RSTP", tone: "ethernet", tag: "loop-free topology", points: ["Redundant paths between switches in general", "Selects a loop-free logical topology", "Some paths wait, Discarding, until needed", "Sees a healthy LAG as ONE path"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="lcl-model" eyebrow="Mental model" title="A multi-lane bridge" tone="violet">
        <p>Picture LAG1 as a road bridge with two lanes. The map (MAC table, spanning tree) shows one bridge. Lane marshals (LACP) at both ends agree which lanes are open and safe. Each car (flow) is waved into one lane and stays in it. Close a lane and traffic squeezes into the other. A lane only reopens once both marshals agree again.</p>
      </GuideSection>

      <GuideSection id="lcl-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <Glossary
          items={[
            { term: "LAG", def: "Link aggregation group — several physical members acting as one logical link." },
            { term: "Actor / Partner", def: "The local end's own information / what it learned about the other end." },
            { term: "Operational key", def: "Local value grouping a system's ports that may aggregate together." },
            { term: "Synchronization", def: "Member attached to the right aggregator, in agreement with the partner." },
            { term: "Collecting / Distributing", def: "Accepting / sending customer frames on the member." },
            { term: "Modeled hash", def: "PacketVerse's illustrative flow-to-member mapping; not a standard." },
          ]}
        />
      </GuideSection>

      <GuideSection id="lcl-recap" eyebrow="Recap" title="What you saw" tone="success">
        <FlowSteps
          steps={[
            { title: "Negotiate", body: "LACPDUs taught each end its Partner; each selected the member into LAG1.", tone: "violet" },
            { title: "Distribute", body: "Two flows used two members, each flow pinned to one.", tone: "cyan" },
            { title: "Survive", body: "A member failure left LAG1 up on one member.", tone: "warning" },
            { title: "Recover", body: "The restored member renegotiated before carrying traffic.", tone: "success" },
            { title: "Repair", body: "An inconsistent local key on SW2 kept a member out; restoring key 20 fixed it.", tone: "danger" },
          ]}
        />
      </GuideSection>
    </div>
  );
}
