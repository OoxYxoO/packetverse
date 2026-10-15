import { Callout, FailureSignatures, FieldTable, GuideSection, Misconceptions, Mono } from "@/components/lesson/GuideBlocks";
import { CliPair, type GuideCliRun } from "@/components/lesson/GuideCli";
import { ExplainIt, KnowledgeQuiz, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { negotiate, PRINTER_CFG, SW_DEFAULT, simulateLink, type Counters, type Negotiated } from "@/lib/sim-engine/scenarios/ccna/cabling";
import { MismatchCounters, NegTable } from "./LessonGuideContent";

export const CAB_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "cbd-copper", label: "Copper categories" },
  { id: "cbd-fiber", label: "Fiber grades and connectors" },
  { id: "cbd-optics", label: "Transceivers and direct-attach cables" },
  { id: "cbd-csma", label: "CSMA/CD, step by step" },
  { id: "cbd-cli", label: "Reading the interface on Cisco and Junos" },
  { id: "cbd-neg", label: "Every negotiation combination" },
  { id: "cbd-signatures", label: "Error signatures" },
  { id: "cbd-myths", label: "Misconceptions" },
  { id: "cbd-explain", label: "Explain it" },
  { id: "cbd-quiz", label: "Check yourself" },
];

/** Cisco-style `show interfaces` excerpt built from the lesson's negotiated link and traffic counters. */
function ciscoShow(n: Negotiated, c: Counters): GuideCliRun {
  return {
    prompt: "ACC-SW1#",
    command: "show interfaces gigabitEthernet1/0/7",
    output: [
      "GigabitEthernet1/0/7 is up, line protocol is up (connected)",
      `  ${n.duplex === "full" ? "Full" : "Half"}-duplex, ${n.speed}Mb/s, media type is 10/100/1000BaseTX`,
      `     ${c.delivered} packets input`,
      `     ${c.crc + c.runts} input errors, ${c.crc} CRC, 0 frame, 0 overrun, 0 ignored`,
      `     ${c.runts} runts, 0 giants`,
      `     ${c.sent} packets output`,
      `     ${c.collisions} collisions, 0 interface resets`,
      `     ${c.lateCollisions} late collision, 0 deferred`,
    ].join("\n"),
  };
}
/** Junos-style `show interfaces extensive` excerpt from the same data, for the far end's view. */
function junosShow(n: Negotiated, c: Counters): GuideCliRun {
  return {
    prompt: "admin@ACC-SW1> ",
    command: "show interfaces ge-0/0/7 extensive",
    output: [
      "Physical interface: ge-0/0/7, Enabled, Physical link is Up",
      `  Link-level type: Ethernet, Speed: ${n.speed}mbps, Duplex: ${n.duplex === "full" ? "Full" : "Half"}-Duplex`,
      "  Input errors:",
      `    Errors: ${c.crc + c.runts}, Drops: 0, Framing errors: ${c.crc}, Runts: ${c.runts}`,
      "  Output errors:",
      `    Carrier transitions: 1, Errors: 0, Collisions: ${c.collisions + c.lateCollisions}`,
      "  MAC statistics:",
      `    CRC/Align errors     ${c.crc}`,
    ].join("\n"),
  };
}

const QUIZ: KnowledgeQuestion[] = [
  {
    id: "cbd-q1",
    prompt: "A 10G link between two racks 3 m apart. The cheapest reliable option?",
    options: [
      { id: "dac", label: "A passive direct-attach copper (DAC) cable" },
      { id: "lr", label: "Single-mode fiber with LR optics" },
      { id: "cat5e", label: "Cat5e" },
      { id: "om4", label: "OM4 with ER optics" },
    ],
    correctId: "dac",
    explanation: "Twinax DACs are SFP+ modules joined by a fixed copper cable: cheap, low power, a few metres of reach — made for in-rack and adjacent-rack links.",
  },
  {
    id: "cbd-q2",
    prompt: "One end shows rising CRC errors; the other end shows nothing unusual and both are full duplex. Most likely?",
    options: [
      { id: "duplex", label: "Duplex mismatch" },
      { id: "signal", label: "A physical signal problem on the path into the end that counts the errors" },
      { id: "vlan", label: "Wrong VLAN" },
      { id: "speed", label: "Speed mismatch" },
    ],
    correctId: "signal",
    explanation: "No collisions anywhere rules out duplex. CRC errors on one receiver point to the cable, connector, optic or interference on that direction.",
  },
  {
    id: "cbd-q3",
    prompt: "Switch port: speed 1000, duplex full (forced). Far end: speed 100, duplex full (forced). Result?",
    options: [
      { id: "down", label: "The link stays down" },
      { id: "half", label: "Up at 100 half" },
      { id: "up", label: "Up at 100 full" },
    ],
    correctId: "down",
    explanation: "Different speeds use different signalling; neither side can understand the other, so there is no link at all. Unlike duplex, a speed mismatch is never silent.",
  },
];

export function CabDeepDiveContent() {
  const forced = { ...SW_DEFAULT, speed: 100 as const, duplex: "full" as const };
  const n = negotiate(forced, PRINTER_CFG);
  const bad = simulateLink("full", "half");
  return (
    <>
      <GuideSection id="cbd-copper" eyebrow="Copper" title="Copper categories">
        <FieldTable
          title="Twisted pair (all to 100 m unless noted)"
          columns={["Category", "Typical use", "Highest Ethernet speed"]}
          rows={[
            ["Cat5e", "Older buildings", "1 Gb/s"],
            ["Cat6", "Most new office runs", "1 Gb/s (10 Gb/s to 55 m)"],
            ["Cat6A", "Wi-Fi 6E/7 APs, 10G to the desk", "10 Gb/s"],
            ["Cat8", "Data center, ≤ 30 m", "25/40 Gb/s"],
          ]}
        />
        <p>Shielded variants (STP/FTP) resist interference near motors and fluorescent lighting. Copper also carries PoE — which is why AP cabling is usually Cat6A.</p>
      </GuideSection>

      <GuideSection id="cbd-fiber" eyebrow="Fiber" title="Fiber grades and connectors">
        <FieldTable
          title="Fiber grades"
          columns={["Grade", "Type", "10G reach", "Jacket colour (common)"]}
          rows={[
            ["OM1 / OM2", "Multimode 62.5 / 50 µm", "33 / 82 m", "orange"],
            ["OM3", "Multimode 50 µm", "300 m", "aqua"],
            ["OM4", "Multimode 50 µm", "400 m", "aqua or violet"],
            ["OS2", "Single-mode 9 µm", "10 km (LR) · 40 km (ER)", "yellow"],
          ]}
        />
        <p>
          Connectors: <Mono>LC</Mono> (small, on SFP modules — the default today), <Mono>SC</Mono> (larger, older patch panels), <Mono>MPO/MTP</Mono> (12 or 24 fibers in one connector, for 40/100G parallel optics).
        </p>
      </GuideSection>

      <GuideSection id="cbd-optics" eyebrow="Optics" title="Transceivers and direct-attach cables">
        <FieldTable
          title="Common pluggables"
          columns={["Form factor", "Speed", "Examples"]}
          rows={[
            ["SFP", "1 Gb/s", "1000BASE-SX (MMF), -LX (SMF), -T (copper)"],
            ["SFP+", "10 Gb/s", "10GBASE-SR, -LR, -ER, DAC"],
            ["SFP28", "25 Gb/s", "Server to leaf"],
            ["QSFP+ / QSFP28", "40 / 100 Gb/s", "Leaf to spine"],
          ]}
        />
        <Callout tone="cyan" title="DAC and AOC">Direct-attach copper (DAC) and active optical cables (AOC) are transceivers permanently joined by a cable — cheap for links of a few metres inside the data center.</Callout>
      </GuideSection>

      <GuideSection id="cbd-csma" eyebrow="Half duplex" title="CSMA/CD, step by step">
        <ol className="list-decimal space-y-1 pl-5">
          <li>Carrier sense: listen; if someone is transmitting, wait.</li>
          <li>Transmit, while still listening.</li>
          <li>Collision detected? Send a 32-bit jam signal, stop.</li>
          <li>Back off a random number of slot times (512 bit-times each) and retry, up to 16 times.</li>
          <li>A collision must be seen within the first 64 bytes. After that it is a late collision: the frame is lost, not retried.</li>
        </ol>
        <p>On a full-duplex link none of this runs. That&apos;s why the full-duplex end of a mismatch never reports collisions — it doesn&apos;t look for them.</p>
      </GuideSection>

      <GuideSection id="cbd-cli" eyebrow="Vendors" title="Reading the interface on Cisco and Junos">
        <p>Both outputs below are built from the lesson&apos;s mismatch traffic run — the switch end on the left in IOS form, the same numbers in Junos form on the right.</p>
        <CliPair cisco={ciscoShow(n.a, bad.sw)} junos={junosShow(n.a, bad.sw)} />
        <p>The words differ; the evidence doesn&apos;t. Speed, duplex, CRC, runts and collisions are in every vendor&apos;s interface view.</p>
      </GuideSection>

      <GuideSection id="cbd-neg" eyebrow="Negotiation" title="Every negotiation combination">
        <NegTable />
        <MismatchCounters />
      </GuideSection>

      <GuideSection id="cbd-signatures" eyebrow="Troubleshooting" title="Error signatures">
        <FailureSignatures
          items={[
            { tag: "Duplex", title: "Duplex mismatch", tone: "danger", points: ["Link up, same speed", "Half end: collisions, late collisions", "Full end: CRC errors, runts", "Slow under load, fine when idle"] },
            { tag: "Speed", title: "Speed mismatch", tone: "warning", points: ["Link down", "No counters move", "Fix: auto on both or same speed"] },
            { tag: "Signal", title: "Bad cable / dirty optic", tone: "violet", points: ["CRC errors on one receiver only", "No collisions", "Optical receive power low (fiber)"] },
            { tag: "Distance", title: "Run too long", tone: "cyan", points: ["Errors or flapping on copper over 100 m", "Link may drop to a lower speed"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="cbd-myths" eyebrow="Misconceptions" title="Misconceptions">
        <Misconceptions
          items={[
            { myth: "Hard-coding speed and duplex makes links more stable.", correction: "Only if both ends are set identically. Setting one end disables negotiation and invites a mismatch." },
            { myth: "Single-mode is always better.", correction: "It reaches further, but its optics cost more. Inside a building, multimode is the usual choice." },
            { myth: "Collisions are normal on Ethernet.", correction: "On hubs and half duplex, yes. On a full-duplex switch port, any collision counter that moves is a fault." },
          ]}
        />
      </GuideSection>

      <GuideSection id="cbd-explain" eyebrow="Explain" title="Explain it">
        <ExplainIt
          items={[
            { q: "Why does the printer fall back to half duplex?", a: "The switch stopped advertising when it was forced. The printer sensed 100 Mb/s from the signal but had no way to learn duplex, so the standard says assume half." },
            { q: "Why are most of the printer's collisions late?", a: "It sends large scan frames. The switch, in full duplex, starts transmitting whenever it likes — usually well past the first 64 bytes of the printer's frame." },
            { q: "Why fresh counters instead of clearing them?", a: "Clearing hides history; a delta over a fresh traffic run proves the errors stopped because of your change." },
          ]}
        />
      </GuideSection>

      <GuideSection id="cbd-quiz" eyebrow="Quiz" title="Check yourself">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>
    </>
  );
}
