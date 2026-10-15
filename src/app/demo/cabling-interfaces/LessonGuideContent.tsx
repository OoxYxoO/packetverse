import { Callout, CompareCards, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, FieldTable, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { KnowledgeCheck } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { MEDIA, RUNS, chooseMedium, negotiate, PRINTER_CFG, SW_DEFAULT, simulateLink, linkText } from "@/lib/sim-engine/scenarios/ccna/cabling";

export const CAB_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "cbl-mission", label: "What this lesson teaches" },
  { id: "cbl-network", label: "The network of this lesson" },
  { id: "cbl-reach", label: "Choose by distance and speed" },
  { id: "cbl-copper", label: "Copper: pairs, pins and 100 m" },
  { id: "cbl-fiber", label: "Fiber: multimode vs single-mode" },
  { id: "cbl-neg", label: "Auto-negotiation" },
  { id: "cbl-shared", label: "Shared media vs point-to-point" },
  { id: "cbl-counters", label: "Interface counters" },
  { id: "cbl-incident", label: "The incident" },
  { id: "cbl-fix", label: "Repair and prove it" },
  { id: "cbl-glossary", label: "Glossary" },
  { id: "cbl-recap", label: "Recap" },
];

const fmt = (m: number) => (m >= 1000 ? `${m / 1000} km` : `${m} m`);

function FloorDiagram() {
  const r = Object.fromEntries(RUNS.map((x) => [x.id, x]));
  return (
    <DiagramSvg h={190} label="PC1 and the printer on copper to ACC-SW1, multimode fiber to DIST-SW in building B, single-mode fiber to the data center">
      <DNode x={60} y={50} label="PC1" sub="1 Gb/s NIC" w={80} />
      <DNode x={60} y={130} label="PRINTER" sub="10/100" w={80} accent={D.warning} />
      <DNode x={240} y={90} label="ACC-SW1" sub="access" w={90} accent={D.eth} />
      <DNode x={420} y={90} label="DIST-SW" sub="building B" w={90} accent={D.ip} />
      <DNode x={590} y={90} label="DC-SW" sub="data center" w={80} accent={D.success} />
      <DLink x1={100} y1={56} x2={195} y2={84} label={`${chooseMedium(r.desk).name.split(" ")[0]} · ${fmt(r.desk.metres)}`} />
      <DLink x1={100} y1={124} x2={195} y2={96} label={`Cat6 · ${fmt(r.printer.metres)}`} labelDy={16} />
      <DLink x1={285} y1={90} x2={375} y2={90} color={D.violet} label={`OM4 · ${fmt(r.uplink.metres)}`} />
      <DLink x1={465} y1={90} x2={550} y2={90} color={D.warning} label={`SMF · ${fmt(r.dc.metres)}`} />
    </DiagramSvg>
  );
}

function ReachDiagram() {
  const max = Math.log10(40000);
  const x0 = 200;
  const w = 400;
  const list = MEDIA.filter((m) => m.reach[10] || m.reach[1]);
  return (
    <DiagramSvg h={40 + list.length * 26} label="Reach of each medium at 10 Gb/s and 1 Gb/s on a logarithmic scale">
      {list.map((m, i) => {
        const r10 = m.reach[10];
        const r1 = m.reach[1];
        const y = 20 + i * 26;
        const bw = (v: number) => (Math.log10(v) / max) * w;
        return (
          <g key={m.id}>
            <text x={x0 - 8} y={y + 9} textAnchor="end" fill={m.legacy ? D.faint : D.text} fontSize={10.5}>
              {m.name}
            </text>
            {r1 ? <rect x={x0} y={y} width={bw(r1)} height={6} rx={3} fill={D.eth} opacity={0.5} /> : null}
            {r10 ? <rect x={x0} y={y + 7} width={bw(r10)} height={6} rx={3} fill={m.kind === "copper" ? D.cyan : m.kind === "multimode" ? D.violet : D.warning} /> : null}
            <text x={x0 + bw(Math.max(r1 ?? 0, r10 ?? 0)) + 6} y={y + 11} fill={D.muted} fontSize={9.5}>
              {r10 ? `10G ${fmt(r10)}` : ""}
              {r1 ? `${r10 ? " · " : ""}1G ${fmt(r1)}` : ""}
            </text>
          </g>
        );
      })}
    </DiagramSvg>
  );
}

function PinDiagram() {
  const pins = ["1", "2", "3", "6"];
  return (
    <DiagramSvg h={170} label="Straight-through: PC pins 1-2 transmit to switch pins 1-2 receive. Crossover: switch 1-2 to switch 3-6">
      <text x={160} y={18} textAnchor="middle" fill={D.muted} fontSize={11} fontWeight={700}>
        straight-through (PC ↔ switch)
      </text>
      <text x={480} y={18} textAnchor="middle" fill={D.muted} fontSize={11} fontWeight={700}>
        crossover (switch ↔ switch)
      </text>
      {pins.map((p, i) => {
        const y = 44 + i * 28;
        const tx = i < 2;
        return (
          <g key={p}>
            <text x={60} y={y + 4} fill={tx ? D.success : D.ip} fontSize={10.5}>{`PC ${p} ${tx ? "TX" : "RX"}`}</text>
            <line x1={120} y1={y} x2={200} y2={y} stroke={tx ? D.success : D.ip} strokeWidth={2} />
            <text x={210} y={y + 4} fill={tx ? D.success : D.ip} fontSize={10.5}>{`SW ${p} ${tx ? "RX" : "TX"}`}</text>
            <text x={380} y={y + 4} fill={tx ? D.success : D.ip} fontSize={10.5}>{`SW ${p} ${tx ? "RX" : "TX"}`}</text>
            <line x1={440} y1={y} x2={520} y2={44 + (tx ? i + 2 : i - 2) * 28} stroke={tx ? D.success : D.ip} strokeWidth={2} />
            <text x={530} y={44 + (tx ? i + 2 : i - 2) * 28 + 4} fill={D.muted} fontSize={10.5}>{`SW ${pins[tx ? i + 2 : i - 2]}`}</text>
          </g>
        );
      })}
    </DiagramSvg>
  );
}

export function NegTable() {
  const forced = { ...SW_DEFAULT, speed: 100 as const, duplex: "full" as const };
  const cases = [
    ["auto", "auto", negotiate(SW_DEFAULT, PRINTER_CFG)],
    ["100 / full", "auto", negotiate(forced, PRINTER_CFG)],
    ["100 / full", "100 / full", negotiate(forced, { ...PRINTER_CFG, speed: 100, duplex: "full" })],
    ["1000 / full", "100 / full", negotiate({ ...forced, speed: 1000 }, { ...PRINTER_CFG, speed: 100, duplex: "full" })],
  ] as const;
  return (
    <FieldTable
      title="Computed by the lesson's negotiation model (switch 10/100/1000, printer 10/100)"
      columns={["Switch set to", "Printer set to", "Switch ends up", "Printer ends up"]}
      rows={cases.map(([a, b, n]) => [a, b, <Mono key="a">{linkText(n.a)}</Mono>, <Mono key="b" tone={n.a.duplex !== n.b.duplex && n.a.up ? "danger" : undefined}>{linkText(n.b)}</Mono>])}
    />
  );
}

export function MismatchCounters() {
  const r = simulateLink("full", "half");
  return (
    <FieldTable
      title="The lesson's traffic run with the mismatch (switch full, printer half)"
      columns={["Counter", "ACC-SW1 Gi1/0/7 (full)", "PRINTER (half)"]}
      rows={[
        ["collisions", <Mono key="1">{r.sw.collisions}</Mono>, <Mono key="2" tone="danger">{r.pr.collisions}</Mono>],
        ["late collisions", <Mono key="3">{r.sw.lateCollisions}</Mono>, <Mono key="4" tone="danger">{r.pr.lateCollisions}</Mono>],
        ["CRC errors", <Mono key="5" tone="danger">{r.sw.crc}</Mono>, <Mono key="6">{r.pr.crc}</Mono>],
        ["runts", <Mono key="7" tone="danger">{r.sw.runts}</Mono>, <Mono key="8">{r.pr.runts}</Mono>],
        ["frames received / sent by the other end", <Mono key="9">{`${r.sw.delivered} / ${r.pr.sent}`}</Mono>, <Mono key="10">{`${r.pr.delivered} / ${r.sw.sent}`}</Mono>],
      ]}
    />
  );
}

export function CabLessonGuideContent() {
  return (
    <>
      <GuideSection id="cbl-mission" eyebrow="Mission" title="What this lesson teaches">
        <p>
          Every packet you will study travels as electrical pulses on copper, light in glass, or radio. This lesson cables an office: a desk, a printer, an uplink to the next building and a link to a data center across town. You will choose
          each medium from its reach, watch the link negotiate, compare shared and point-to-point Ethernet, and then diagnose a printer that crawls because its two ends disagree.
        </p>
        <Callout tone="violet" title="CCNA 1.3 · 1.4">
          Physical interface and cabling types (single-mode and multimode fiber, copper, shared media and point-to-point) and interface and cable issues (collisions, errors, duplex and speed mismatches).
        </Callout>
      </GuideSection>

      <GuideSection id="cbl-network" eyebrow="Topology" title="The network of this lesson">
        <DiagramFrame caption="Four runs, three media. The legacy lab hub hangs off ACC-SW1 too.">
          <FloorDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="cbl-reach" eyebrow="Idea" title="Choose by distance and speed">
        <p>Each medium has a maximum reach at each speed. The rule is simple: the cheapest medium that reaches. The lesson computes it for every run.</p>
        <ReachDiagram />
        <FieldTable
          title="The lesson's runs"
          columns={["Run", "Distance", "Speed", "Chosen", "Standard"]}
          rows={RUNS.map((r) => {
            const m = chooseMedium(r);
            return [`${r.from} → ${r.to}`, fmt(r.metres), `${r.gbps} Gb/s`, m.name, m.standard[r.gbps] ?? "—"];
          })}
        />
      </GuideSection>

      <GuideSection id="cbl-copper" eyebrow="Copper" title="Copper: pairs, pins and 100 m">
        <p>
          Twisted-pair copper (UTP) carries Ethernet up to 100 m: 90 m of permanent cable in the wall plus up to 10 m of patch cords. 10/100 Mb/s Ethernet uses two pairs (pins 1-2 and 3-6); 1000BASE-T and 10GBASE-T use all four
          pairs in both directions at once. A NIC transmits on 1-2; a switch port receives there — so a straight-through cable joins them, and two switches need a crossover, unless Auto-MDIX swaps the pairs.
        </p>
        <PinDiagram />
        <KnowledgeCheck
          label="Check"
          question={{
            id: "cbl-k1",
            prompt: "A new office run is 120 m. What do you do?",
            options: [
              { id: "cat6a", label: "Use Cat6A — it goes further" },
              { id: "fiber", label: "Use fiber, or put a switch in a closet closer to the desks" },
              { id: "ok", label: "Use Cat6 — 20 m over is fine" },
            ],
            correctId: "fiber",
            explanation: "Every twisted-pair category is specified to 100 m. Beyond that, either the medium changes (fiber) or the switch moves closer.",
          }}
        />
      </GuideSection>

      <GuideSection id="cbl-fiber" eyebrow="Fiber" title="Fiber: multimode vs single-mode">
        <CompareCards
          items={[
            { title: "Multimode (OM3/OM4)", tone: "violet", tag: "50 µm core · 850 nm", points: ["Many light paths (modes)", "Modal dispersion limits reach: ~300–400 m at 10G", "Cheaper optics (SR) — inside buildings and campuses"] },
            { title: "Single-mode (OS2)", tone: "warning", tag: "9 µm core · 1310/1550 nm", points: ["One light path", "10 km (LR) to 40 km (ER) and beyond", "Between buildings, metro and provider links"] },
          ]}
        />
        <Callout tone="cyan" title="Transceivers decide the reach">
          The switch port is a cage; the SFP/SFP+ module decides wavelength and reach, and both ends must match the fiber type. Fiber connectors here are LC duplex: one strand transmits, the other receives.
        </Callout>
      </GuideSection>

      <GuideSection id="cbl-neg" eyebrow="Interfaces" title="Auto-negotiation">
        <p>
          Before the first frame, both ends exchange fast link pulses advertising their speeds and duplex modes and pick the best one they share. If one end is set by hand, it stops advertising. The other end can still sense the speed
          from the signal (parallel detection) but has no way to learn the duplex, so at 10 or 100 Mb/s it assumes half duplex.
        </p>
        <NegTable />
        <Callout tone="warning" title="The rule">Auto on both ends, or the same fixed speed and duplex on both ends. Never one of each.</Callout>
      </GuideSection>

      <GuideSection id="cbl-shared" eyebrow="Media" title="Shared media vs point-to-point">
        <CompareCards
          items={[
            { title: "Shared (hub)", tone: "warning", tag: "half duplex · CSMA/CD", points: ["A hub repeats bits to every port", "One collision domain for all ports", "Listen before talking; back off after a collision"] },
            { title: "Point-to-point (switch port)", tone: "success", tag: "full duplex", points: ["Two devices per link", "Each port is its own collision domain", "Separate transmit and receive: no collisions at all"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="cbl-counters" eyebrow="Evidence" title="Interface counters">
        <FieldTable
          title="What each counter means"
          columns={["Counter", "Means", "Typical cause"]}
          rows={[
            ["CRC / FCS errors", "Frame arrived but its checksum didn't match", "Bad cable or optic, interference, or the far end aborting frames (duplex mismatch)"],
            ["Runts", "Frames shorter than 64 bytes", "Collisions cutting frames short"],
            ["Giants", "Frames longer than the MTU allows", "MTU mismatch"],
            ["Collisions", "Half-duplex end transmitted while receiving", "Normal in small numbers on hubs; abnormal on switch ports"],
            ["Late collisions", "Collision after the first 64 bytes", "Duplex mismatch, or a cable far beyond spec"],
            ["Input errors", "Total of receive-side errors", "Any of the above"],
          ]}
        />
        <p>
          Cisco: <Mono>show interfaces Gi1/0/7</Mono>, <Mono>show interfaces status</Mono>. Junos: <Mono>show interfaces ge-0/0/7 extensive</Mono>. Always compare both ends of the same cable.
        </p>
      </GuideSection>

      <GuideSection id="cbl-incident" eyebrow="Incident" title="The incident" tone="danger">
        <p>A technician sets the printer&apos;s switch port to 100 Mb/s full duplex and leaves the printer on auto. The link comes up, then printing and scanning crawl.</p>
        <MismatchCounters />
        <TroubleshootingFlow
          steps={[
            { question: "Is the link up on both ends?", look: "Interface status on the switch; link light on the printer." },
            { question: "Do speed and duplex match on both ends?", look: <><Mono>show interfaces status</Mono> on the switch; the printer&apos;s network status page.</> },
            { question: "Which end reports which errors?", look: "Late collisions on one end + CRC/runts on the other = duplex mismatch. CRC alone = signal problem." },
          ]}
        />
      </GuideSection>

      <GuideSection id="cbl-fix" eyebrow="Repair" title="Repair and prove it" tone="success">
        <p>
          Returning the switch port to auto lets both ends advertise again: the printer supports 10/100, so the link becomes {linkText(negotiate(SW_DEFAULT, PRINTER_CFG).a)} on both. Fresh counters after the fix — not a counter reset —
          show zero CRC errors, runts and collisions. Replacing the cable or changing the VLAN can&apos;t help; forcing the printer to half duplex just makes the mismatch permanent.
        </p>
      </GuideSection>

      <GuideSection id="cbl-glossary" eyebrow="Words" title="Glossary">
        <Glossary
          items={[
            { term: "UTP", def: "Unshielded twisted pair: four twisted copper pairs, RJ-45 connectors, 100 m." },
            { term: "Multimode fiber", def: "Wide core, many light paths; short-reach optics at 850 nm." },
            { term: "Single-mode fiber", def: "Narrow core, one light path; long-reach lasers at 1310/1550 nm." },
            { term: "SFP / SFP+", def: "Pluggable transceivers for 1G / 10G; choose by medium and reach." },
            { term: "Auto-MDIX", def: "A port that swaps transmit and receive pairs automatically." },
            { term: "Parallel detection", def: "Sensing the far end's speed when it doesn't auto-negotiate; duplex is assumed half at 10/100." },
            { term: "Late collision", def: "A collision detected after the first 64 bytes of a frame." },
          ]}
        />
      </GuideSection>

      <GuideSection id="cbl-recap" eyebrow="Recap" title="Recap" tone="success">
        <ul className="list-disc space-y-1 pl-5">
          <li>Copper 100 m; multimode hundreds of metres; single-mode kilometres — pick the cheapest that reaches.</li>
          <li>Auto on both ends or identical fixed settings on both ends.</li>
          <li>Hubs share one collision domain; switch ports are point-to-point and full duplex.</li>
          <li>Late collisions on one end, CRC errors and runts on the other: duplex mismatch.</li>
        </ul>
      </GuideSection>
    </>
  );
}
