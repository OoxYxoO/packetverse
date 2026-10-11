import { ChecklistCard, CompareCards, Glossary, DArrow, DIAGRAM as D, DLink, DNode, DPill, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { CliPanel, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { createOsNet, osApply, osClone, osTicket, osTicketState, type OsRouter, type OsState } from "@/lib/sim-engine/scenarios/ospfNet";
import { osRouterSets, type OsCliApi } from "./ospf-lab/osCli";

export const OSPF_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "ol-mission", label: "What this lesson teaches" },
  { id: "ol-network", label: "The network of this lesson" },
  { id: "ol-ideas", label: "Three ideas you need" },
  { id: "ol-walk", label: "What you will watch" },
  { id: "ol-problem", label: "Static routes don't react" },
  { id: "ol-hello", label: "Hellos: becoming neighbors" },
  { id: "ol-sync", label: "Synchronizing the maps" },
  { id: "ol-flood", label: "One map on every router" },
  { id: "ol-spf", label: "SPF: R1 picks its path" },
  { id: "ol-change", label: "One cost changes" },
  { id: "ol-verify", label: "What healthy OSPF looks like" },
  { id: "ol-incident", label: "The incident" },
  { id: "ol-investigate", label: "Walk the chain" },
  { id: "ol-repair", label: "Repair and prove it" },
  { id: "ol-other", label: "Other ways OSPF breaks" },
  { id: "ol-model", label: "Mental model" },
  { id: "ol-glossary", label: "Glossary" },
  { id: "ol-recap", label: "Recap" },
  { id: "ol-practice", label: "Practice it" },
];

const P = { R1: [110, 120], R2: [320, 44], R3: [320, 196], R4: [530, 120] } as const;
type R = keyof typeof P;

export function Diamond({ highlight = [], costs = {}, note, h = 240 }: { highlight?: [R, R][]; costs?: Partial<Record<string, string>>; note?: string; h?: number }) {
  const links: [R, R, string][] = [
    ["R1", "R2", costs["R1-R2"] ?? "10"],
    ["R2", "R4", costs["R2-R4"] ?? "10"],
    ["R1", "R3", costs["R1-R3"] ?? "20"],
    ["R3", "R4", costs["R3-R4"] ?? "5"],
  ];
  const lit = (a: R, b: R) => highlight.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  return (
    <DiagramSvg h={h} label="Four routers in a diamond: R1 to R2 cost 10, R2 to R4 cost 10, R1 to R3 cost 20, R3 to R4 cost 5">
      {links.map(([a, b, c]) => (
        <DLink key={a + b} x1={P[a][0]} y1={P[a][1]} x2={P[b][0]} y2={P[b][1]} color={lit(a, b) ? D.ospf : D.line} label={`cost ${c}`} labelDy={a === "R1" && b === "R3" ? 16 : a === "R3" ? 16 : -8} />
      ))}
      <DNode x={P.R1[0]} y={P.R1[1]} label="R1" sub="1.1.1.1" />
      <DNode x={P.R2[0]} y={P.R2[1]} label="R2" sub="2.2.2.2" />
      <DNode x={P.R3[0]} y={P.R3[1]} label="R3" sub="3.3.3.3" />
      <DNode x={P.R4[0]} y={P.R4[1]} label="R4" sub="4.4.4.4" />
      {note && (
        <text x={320} y={h - 8} textAnchor="middle" fill={D.muted} fontSize={10.5}>
          {note}
        </text>
      )}
    </DiagramSvg>
  );
}

export function HelloDiagram() {
  return (
    <DiagramSvg h={200} label="R1 Hello lists no neighbors, so R2 goes to INIT; R2 Hello lists R1, so R1 goes to 2-WAY">
      <text x={110} y={20} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={600}>
        R1 (1.1.1.1)
      </text>
      <text x={530} y={20} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={600}>
        R2 (2.2.2.2)
      </text>
      <line x1={110} y1={30} x2={110} y2={190} stroke={D.line} strokeDasharray="3 4" />
      <line x1={530} y1={30} x2={530} y2={190} stroke={D.line} strokeDasharray="3 4" />
      <DArrow x1={112} y1={46} x2={526} y2={70} color={D.ospf} label="Hello · neighbors seen: (none)" labelDy={-10} />
      <DPill x={586} y={88} text="INIT" color={D.warning} w={64} />
      <DArrow x1={528} y1={108} x2={114} y2={132} color={D.ospf} label="Hello · neighbors seen: 1.1.1.1" labelDy={-10} />
      <DPill x={60} y={152} text="2-WAY" color={D.success} w={64} />
      <text x={320} y={182} textAnchor="middle" fill={D.muted} fontSize={10}>
        sent to 224.0.0.5 · IP protocol 89 · TTL 1 · Hello 10s / Dead 40s
      </text>
    </DiagramSvg>
  );
}

export function SyncDiagram() {
  const row = (y: number, dir: "r" | "l", label: string, color: string) =>
    dir === "r" ? <DArrow x1={112} y1={y} x2={526} y2={y + 14} color={color} label={label} labelDy={-8} /> : <DArrow x1={528} y1={y} x2={114} y2={y + 14} color={color} label={label} labelDy={-8} />;
  return (
    <DiagramSvg h={250} label="Database synchronization between R1 and R2: DBD negotiation, DBD exchange, LSR, LSU and LSAck">
      <text x={110} y={20} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={600}>
        R1 (slave)
      </text>
      <text x={530} y={20} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={600}>
        R2 (master, higher RID)
      </text>
      <line x1={110} y1={30} x2={110} y2={240} stroke={D.line} strokeDasharray="3 4" />
      <line x1={530} y1={30} x2={530} y2={240} stroke={D.line} strokeDasharray="3 4" />
      <DPill x={320} y={40} text="EXSTART" color={D.violet} w={80} />
      {row(58, "l", "empty DBD (I, M, MS) · negotiate master", D.violet)}
      <DPill x={320} y={96} text="EXCHANGE" color={D.violet} w={86} />
      {row(112, "l", "DBD with LSA headers", D.ospf)}
      <DPill x={320} y={150} text="LOADING" color={D.warning} w={80} />
      {row(166, "r", "LSR: send me R2's Router-LSA", D.warning)}
      {row(196, "l", "LSU: R2's Router-LSA", D.ospf)}
      {row(222, "r", "LSAck → FULL", D.success)}
    </DiagramSvg>
  );
}

export function FloodDiagram() {
  return (
    <DiagramSvg h={240} label="R1's Router-LSA floods to R2 and R3, which re-flood it to R4">
      <DLink x1={110} y1={120} x2={320} y2={44} />
      <DLink x1={320} y1={44} x2={530} y2={120} />
      <DLink x1={110} y1={120} x2={320} y2={196} />
      <DLink x1={320} y1={196} x2={530} y2={120} />
      <DArrow x1={150} y1={96} x2={270} y2={54} color={D.ospf} label="LSU" labelDy={-6} />
      <DArrow x1={150} y1={144} x2={270} y2={186} color={D.ospf} label="LSU" labelDy={18} />
      <DArrow x1={370} y1={54} x2={490} y2={96} color={D.ospf} dashed label="re-flood" labelDy={-6} />
      <DArrow x1={370} y1={186} x2={490} y2={144} color={D.ospf} dashed label="re-flood" labelDy={18} />
      <DNode x={110} y={120} label="R1" sub="originates LSA" />
      <DNode x={320} y={44} label="R2" />
      <DNode x={320} y={196} label="R3" />
      <DNode x={530} y={120} label="R4" sub="learns R1's LSA" />
    </DiagramSvg>
  );
}

export function AreaMismatchDiagram() {
  return (
    <DiagramSvg h={170} label="R1's Hello carries Area 0 but R2's interface is in Area 1, so R2 discards it">
      <DNode x={110} y={70} label="R1" sub="iface area 0" />
      <DNode x={530} y={70} label="R2" sub="iface area 1" accent={D.danger} />
      <DArrow x1={162} y1={70} x2={440} y2={70} color={D.ospf} label="Hello · Area 0.0.0.0" />
      <text x={462} y={76} fill={D.danger} fontSize={18} fontWeight={700}>
        ✕
      </text>
      <text x={320} y={120} textAnchor="middle" fill={D.danger} fontSize={11} fontWeight={700}>
        Area ID mismatch → Hello discarded → no neighbor entry, no adjacency
      </text>
      <text x={320} y={142} textAnchor="middle" fill={D.muted} fontSize={10}>
        the cable, IPs and the rest of the area are fine; only this adjacency is gone
      </text>
    </DiagramSvg>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the OSPF Lab" onPractice={openLab}>
      Same diamond, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

/** The lab's own command sets, run against lab states: what this page shows is what the OSPF Lab prints. */
function lessonCli(s: OsState, r: OsRouter, vendor: CliVendor, command: string) {
  const exec = { kind: "exec" } as const;
  const api: OsCliApi = { view: s, act: () => s, ios: { R1: exec, R2: exec, R3: exec, R4: exec }, setIos: () => undefined, junosEdit: { R1: false, R2: false, R3: false, R4: false }, setJunosEdit: () => undefined, cand: osClone(s.cfg.r), setCand: () => undefined };
  return runGuideCli(osRouterSets(api, r)[vendor]!, command);
}
const HEALTHY = createOsNet();
const BROKEN = osTicket("area").repro.reduce((acc, a) => osApply(acc, a), osTicketState("area", 1));

export function OspfLessonGuideContent() {
  return (
    <>
      <GuideSection id="ol-mission" eyebrow="This lesson" title="What this lesson teaches" tone="ospf">
        <p>
          Four routers, R1 to R4, are cabled in a diamond, each with a LAN behind it. At the start R1 only knows its own links; it has no idea what lies behind R2, R3 or R4. In the Routing lesson you would type static routes. Here you let <b className="text-pv-text">OSPF</b> discover the network, so that R1 reaches R4 with no static route at all.
        </p>
        <p>You will watch two routers become neighbors, synchronize their maps, flood every router&apos;s description to every other router, and compute the best path. Then one cost changes, an adjacency breaks, and you find out why, fix it, and prove it.</p>
        <ChecklistCard
          tone="violet"
          title="By the end of this lesson you can"
          mark="→"
          items={[
            "follow R1 and R2 from DOWN to FULL",
            "explain how all four routers end up with the same map",
            "compute R1's best path to R4 from the link costs",
            "predict how one cost change moves the path",
            "find why R1 and R2 stopped forming an adjacency, fix it, and prove it",
          ]}
        />
      </GuideSection>

      <GuideSection id="ol-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="Router IDs 1.1.1.1 – 4.4.4.4, all interfaces in Area 0, every link point-to-point. The numbers are each link's cost.">
          <Diamond />
        </DiagramFrame>
        <FieldTable
          title="Point-to-point links"
          accent="ospf"
          columns={["Link", "Addresses", "Cost"]}
          rows={[
            ["R1 ↔ R2", <Mono key="a">10.0.12.1 / 10.0.12.2</Mono>, "10"],
            ["R1 ↔ R3", <Mono key="b">10.0.13.1 / 10.0.13.2</Mono>, "20"],
            ["R2 ↔ R4", <Mono key="c">10.0.24.1 / 10.0.24.2</Mono>, "10"],
            ["R3 ↔ R4", <Mono key="d">10.0.34.1 / 10.0.34.2</Mono>, "5"],
          ]}
        />
        <p>Each router has a LAN with a host: 192.168.1.0/24 behind R1 (H1) up to 192.168.4.0/24 behind R4 (H4).</p>
      </GuideSection>

      <GuideSection id="ol-ideas" eyebrow="This lesson" title="Three ideas you need" tone="cyan">
        <FlowSteps
          steps={[
            { title: "Neighbors first", body: "Routers find each other with Hellos. Area and timers must match, or no neighbor forms.", tone: "violet" },
            { title: "One shared map", body: "Every router describes its own links in a Router-LSA and floods it to all the others. All four end up with the same map.", tone: "warning" },
            { title: "Each router computes its own path", body: "From the map, each router adds up outgoing costs from its own position: R1 → R2 → R4 = 20 beats R1 → R3 → R4 = 25.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="ol-walk" eyebrow="This lesson" title="What you will watch, step by step" tone="warning">
        <FlowSteps
          steps={[
            { title: "Adjacency", body: "R1 and R2 exchange Hellos: DOWN → INIT → 2-WAY.", tone: "violet" },
            { title: "Database sync", body: "They swap LSA headers, request what is missing, and reach FULL.", tone: "ospf" },
            { title: "Flooding", body: "Every Router-LSA reaches every router, so all four databases match.", tone: "warning" },
            { title: "SPF", body: "R1 computes its shortest path to R4: via R2, total 20.", tone: "success" },
            { title: "Reconvergence", body: "One cost changes: a new LSA is flooded and the best path moves.", tone: "danger" },
            { title: "The incident", body: "R1 and R2 stop forming an adjacency. You find the cause and fix it.", tone: "ip" },
          ]}
        />
        <p className="text-sm text-pv-text-muted">The sections below walk through each step on the diamond, in the same order.</p>
      </GuideSection>

      <GuideSection id="ol-problem" eyebrow="The problem" title="Static routes don't react" tone="danger">
        <p>In the Routing lesson every route was typed by hand. Four routers and four LANs already mean twelve static routes, and a static route never changes by itself: when a link fails, traffic keeps being sent into it until someone edits every router. OSPF replaces that work: routers find each other, share what they know, and compute the best paths themselves, again whenever something changes.</p>
      </GuideSection>

      <GuideSection id="ol-hello" eyebrow="Neighbors" title="Hellos: becoming neighbors" tone="ospf">
        <p>Every 10 s each OSPF interface sends a Hello to 224.0.0.5 with its router ID, its area, its timers, and the neighbors it already hears. When R2 first hears R1, R1 lists no neighbors yet, so R2 is only in <b className="text-pv-text">INIT</b>. When a router sees its own ID in the other&apos;s Hello, two-way contact is proven: <b className="text-pv-text">2-WAY</b>. If the area or the timers don&apos;t match, the Hello is simply discarded and no neighbor forms. Keep that in mind: it is the key to the incident.</p>
        <DiagramFrame caption="The neighbor list inside the Hello is what proves two-way communication.">
          <HelloDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ol-sync" eyebrow="Database sync" title="Synchronizing the maps" tone="violet">
        <p>On a point-to-point link every 2-WAY neighbor goes on to become fully adjacent. The two routers agree who leads the exchange (the higher router ID), swap the headers of the LSAs they hold, request only what they are missing, and then the adjacency is <b className="text-pv-text">FULL</b>.</p>
        <DiagramFrame caption="Headers first, then only the missing LSAs are requested, delivered and acknowledged.">
          <SyncDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ol-flood" eyebrow="Flooding" title="One map on every router" tone="warning">
        <p>Each router describes itself in one <strong>Router-LSA</strong>: its FULL neighbors with its cost toward each, and its networks (its LAN, its link subnets, its loopback). A router that receives a newer LSA installs it and passes it on. R4 has no link to R1, yet it gets R1&apos;s LSA through R2 and R3. Every router ends up holding the same four LSAs: one shared map.</p>
        <DiagramFrame caption="Flooding is reliable: each LSU is acknowledged.">
          <FloodDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ol-spf" eyebrow="SPF" title="SPF: R1 picks its path" tone="success">
        <p>Each router runs Dijkstra&apos;s shortest-path-first algorithm on the map with itself as the root, adding up the cost of every outgoing interface. For R1 → R4: via R2 = 10 + 10 = 20, via R3 = 20 + 5 = 25. R1 installs the path via R2, and H1 → H4 reaches R4&apos;s LAN with metric 21. R4 computes its own tree for the way back.</p>
        <DiagramFrame caption="R1 → R2 → R4 = 20 beats R1 → R3 → R4 = 25.">
          <Diamond highlight={[["R1", "R2"], ["R2", "R4"]]} note="best path: R1 → R2 → R4 (total 20)" h={260} />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ol-change" eyebrow="Reconvergence" title="One cost changes, and the path moves" tone="danger">
        <p>Raise R1&apos;s cost toward R2 from 10 to 50: R1 originates a new Router-LSA, floods it, and every router reruns SPF. R1 → R2 → R4 now costs 60 while R1 → R3 → R4 still costs 25. Nothing was disabled: one number in the shared map changed. A link that goes down works the same way, within a second.</p>
        <DiagramFrame caption="After the change: R1 → R3 → R4 (total 25) wins.">
          <Diamond costs={{ "R1-R2": "50" }} highlight={[["R1", "R3"], ["R3", "R4"]]} note="after the change: R1 → R3 → R4 (total 25) wins" h={260} />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ol-verify" eyebrow="Verification" title="What healthy OSPF looks like on the routers" tone="success">
        <p>Check the chain in the order it is built: neighbors, then the map, then the routing table.</p>
        <FieldTable
          title="Read the lesson on the router"
          columns={["Question", "Cisco IOS", "Junos", "What the answer proves"]}
          rows={[
            ["Are all neighbors FULL?", <Mono key="1">show ip ospf neighbor</Mono>, <Mono key="2">show ospf neighbor</Mono>, "Every link has an adjacency"],
            ["Is every router in the map?", <Mono key="3">show ip ospf database</Mono>, <Mono key="4">show ospf database</Mono>, "Four Router-LSAs on every router"],
            ["Which path does R1 use?", <Mono key="5">show ip route ospf</Mono>, <Mono key="6">show route protocol ospf</Mono>, "192.168.4.0/24 via R2, metric 21"],
          ]}
        />
        <p>On a healthy R1 both neighbors are FULL:</p>
        <CliPanel run={lessonCli(HEALTHY, "R1", "cisco", "show ip ospf neighbor")} caption="R1 · Cisco IOS · healthy" />
        <p>And traffic confirms it: a traceroute from H1 to H4 goes R1 → R2 → R4.</p>
      </GuideSection>

      <GuideSection id="ol-incident" eyebrow="Incident" title="The incident: R1 and R2 stop being neighbors" tone="danger">
        <p>After a change on R2, H1 → H4 still works but takes the long way, through R3. The cable between R1 and R2 is up and the addresses are unchanged.</p>
        <DiagramFrame caption="R1's Hello carries Area 0 but R2's interface is in Area 1, so R2 discards it.">
          <AreaMismatchDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Why it fails", tone: "danger", tag: "cause", points: ["R2's interface toward R1 was moved into Area 1", "Each Hello carries its area, so each router discards the other's Hellos", "No adjacency, so the R1–R2 link drops out of the map, and SPF takes R1 → R3 → R4"] },
            { title: "What it can't be", tone: "warning", tag: "red herrings", points: ["A cable fault: the link is up and pings across it work", "A cost change: the costs are unchanged; the link is simply missing", "An MTU mismatch: that would leave the neighbor stuck in EXSTART, not missing"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="ol-investigate" eyebrow="Investigation" title="Walk the chain: neighbor, map, table" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "No reply, or a longer path than designed?", look: "traceroute H1 → H4: through R3, the longer path." },
            { question: "Are all neighbors FULL?", look: "show ip ospf neighbor on R1: R2 (2.2.2.2) is missing." },
            { question: "Why are the Hellos rejected?", look: "show logging on R1: mismatched area ID; show ip ospf interface on R2: Gi0/1 in area 1." },
          ]}
        />
        <CliPanel run={lessonCli(BROKEN, "R1", "cisco", "show ip ospf neighbor")} caption="R1 · Cisco IOS · during the incident" />
      </GuideSection>

      <GuideSection id="ol-repair" eyebrow="Repair" title="Repair, and prove it with a traceroute" tone="success">
        <CompareCards
          items={[
            { title: "Cisco IOS · R2", tone: "cyan", tag: "back into Area 0", points: ["interface Gi0/1", "ip ospf 1 area 0"] },
            { title: "Junos · R2", tone: "violet", tag: "candidate → commit", points: ["delete protocols ospf area 0.0.0.1 interface ge-0/0/1", "set protocols ospf area 0.0.0.0 interface ge-0/0/1", "commit"] },
          ]}
        />
        <ChecklistCard
          tone="success"
          title="The proof"
          mark="✓"
          items={[
            "show ip ospf neighbor on R1: 2.2.2.2 FULL again",
            "R1's route to 192.168.4.0/24 is via R2 again, metric 21",
            "A fresh traceroute H1 → H4 goes R1 → R2 → R4",
            "No new mismatch messages in R1's log",
          ]}
        />
      </GuideSection>

      <GuideSection id="ol-other" eyebrow="Troubleshooting" title="Other ways OSPF breaks" tone="warning">
        <p>A Hello mismatch is one way to lose a piece of the map. The lab&apos;s tickets add four more, each a different break in the chain neighbor → map → SPF → table. The Deep Dive walks through all five with real Cisco and Junos output.</p>
        <CompareCards
          items={[
            { title: "An MTU mismatch", tone: "warning", tag: "stuck in EXSTART", points: ["The neighbor is visible but never FULL", "The MTU is checked in the database exchange"] },
            { title: "A LAN that isn't advertised", tone: "violet", tag: "missing from the map", points: ["Everything FULL, but nobody has the LAN", "Its router's LSA lists no network for it"] },
            { title: "A wrong cost", tone: "ip", tag: "long way round", points: ["Everything FULL, traffic takes the other path", "Compare the costs per direction"] },
            { title: "A leftover static route", tone: "danger", tag: "overrides OSPF", points: ["S [1/0] where you expect O [110/x]", "Static (distance 1) beats OSPF (110)"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="ol-model" eyebrow="Mental model" title="Everyone holds the same map" tone="violet">
        <p>Picture four navigators who each draw their own piece of the map and hand a copy to everyone they can shake hands with. Once every navigator holds the same complete map, each plans its own route from where it stands: the costs on the roads are the only thing that decides. Change one road&apos;s cost and everyone redraws. Refuse a handshake (the wrong area, the wrong timers) and that road vanishes from every copy of the map, even though it is still there.</p>
      </GuideSection>

      <GuideSection id="ol-glossary" eyebrow="Glossary" title="Terms used in this lesson" tone="cyan">
        <Glossary
          items={[
            { term: "Router ID", def: "A 32-bit number naming the router in OSPF (here 1.1.1.1 to 4.4.4.4)." },
            { term: "Hello", def: "Sent every 10 s: finds neighbors and checks that area and timers match." },
            { term: "FULL", def: "Neighbor state: databases synchronized; SPF can use the link." },
            { term: "Router-LSA", def: "A router's description of its links and networks." },
            { term: "SPF", def: "Dijkstra's shortest-path-first algorithm, run by each router from its own position." },
            { term: "Cost", def: "Per outgoing interface; a path's metric is the sum of its outgoing costs." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ol-recap" eyebrow="Recap" title="What you can now explain" tone="success">
        <ChecklistCard tone="cyan" title="OSPF in this lesson" mark="→" items={["R1 reaches R4 with no static route: OSPF discovered the paths", "R1 and R2 went DOWN → INIT → 2-WAY → FULL", "All four routers hold the same four Router-LSAs", "R1 → R2 → R4 (20) beats R1 → R3 → R4 (25)", "One cost change re-floods an LSA and moves the path", "A Hello field that doesn't match means no adjacency, and that link vanishes from the map"]} />
      </GuideSection>

      <GuideSection id="ol-practice" eyebrow="Practice" title="Practice it" tone="cyan">
        <p>You now know what every router should hold and how to prove it. The OSPF Lab gives you the same diamond, as Cisco IOS or Junos:</p>
        <FlowSteps
          steps={[
            { title: "Learn (6 levels)", body: "The same steps as this page, one decision at a time.", tone: "violet" },
            { title: "Challenges", body: "Read a Hello, send H1 → H4 through R3 by cost alone, make R1 load-share, lose a link without losing H4.", tone: "warning" },
            { title: "Troubleshoot (5 tickets)", body: "This lesson's incident and the four other faults above, reported as users report them.", tone: "danger" },
          ]}
        />
        <ChecklistCard
          tone="violet"
          mark="→"
          title="The guided lesson's cost challenge: how to think about it"
          items={[
            "Steer R1's path to R4 through R3 by changing only one cost",
            "Keep the R3 path's total fixed, and work out what the R2 path's total must exceed",
            "Remember that equal totals are a tie (two next hops), not a win for R3",
          ]}
        />
        <PresentationBridge>See Hellos, an LSA flood, SPF choosing a path and a static route winning in the OSPF presentation.</PresentationBridge>
        <LessonLabBridge />
        <p className="text-sm text-pv-text-muted">For the full course (packet types, neighbor states, DR/BDR, LSA types, ECMP, the routing table, real device output for every fault, a knowledge check), open the Deep Dive tab.</p>
      </GuideSection>
    </>
  );
}
