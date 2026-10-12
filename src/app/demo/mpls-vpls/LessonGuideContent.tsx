import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, FlowSteps, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPair, CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { createVsNet, vsApply, vsTicket, vsTicketState, type VsCe, type VsOs, type VsR, type VsState } from "@/lib/sim-engine/scenarios/vsNet";
import { vsSets, vsStaticApi } from "./vs-lab/vsCli";

export const VPLS_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "pl-mission", label: "What this lesson teaches" },
  { id: "pl-network", label: "The network of this lesson" },
  { id: "pl-ideas", label: "Three ideas you need" },
  { id: "pl-watch", label: "What you will watch" },
  { id: "pl-bridge", label: "Each PE is a bridge" },
  { id: "pl-mesh", label: "The pseudowire full mesh" },
  { id: "pl-labels", label: "Six directional labels" },
  { id: "pl-learn", label: "Learning and flooding" },
  { id: "pl-known", label: "Known unicast" },
  { id: "pl-split", label: "Split horizon" },
  { id: "pl-aging", label: "Aging and moves" },
  { id: "pl-working", label: "What working looks like" },
  { id: "pl-incident", label: "The incident" },
  { id: "pl-investigate", label: "Walk the evidence" },
  { id: "pl-fix", label: "Repair and prove it" },
  { id: "pl-other", label: "Other ways a VPLS fails" },
  { id: "pl-model", label: "Mental model" },
  { id: "pl-glossary", label: "Glossary" },
  { id: "pl-recap", label: "Recap" },
  { id: "pl-practice", label: "Practice it" },
];

/**
 * Every CLI sample and ping result on this page comes from the VPLS Lab's model and its IOS XR / Junos command sets:
 * the healthy network (and its MAC tables after real pings) and the lab's "mesh" ticket — the guided lesson's incident
 * (the PE1–PE3 pseudowire is down: PE3 no longer lists PE1 as a neighbor).
 */
export const VS_HEALTHY: VsState = createVsNet(0);
export const VS_HEALTHY_JN: VsState = createVsNet(0, "junos");
const ping = (s: VsState, from: VsCe, dst: string) => vsApply(s, { type: "test", from, dst });
/** After CE1 → CE3 once: every table has learned what that exchange taught it. */
export const VS_LEARNED = ping(VS_HEALTHY, "CE1", "192.168.100.3");
export const VS_LEARNED_JN = ping(VS_HEALTHY_JN, "CE1", "192.168.100.3");
const VS_AGAIN = ping(VS_LEARNED, "CE1", "192.168.100.3");
const fault = (os: VsOs) => vsTicket("mesh").repro.reduce((acc, a) => vsApply(acc, a), vsTicketState("mesh", 0, os));
const VS_FAULT = fault("xr");
const VS_FAULT_JN = fault("junos");
const VS_FAULT_OK = ping(VS_FAULT, "CE1", "192.168.100.2");
const VS_FIXED = ping(vsApply(VS_FAULT, { type: "set", text: "PE3: neighbor 1.1.1.1 pw-id 500 back in the VFI", changes: [{ dev: "PE3", f: (c) => void c.bd!.nbrs.push({ ip: "1.1.1.1", pwid: 500 }) }] }), "CE1", "192.168.100.3");
export function vsCli(s: VsState, r: VsR, vendor: CliVendor, command: string) {
  return runGuideCli(vsSets(vsStaticApi(s, r), r)[vendor], command);
}
export function vsOnly(s: VsState, r: VsR, vendor: CliVendor, command: string, match: RegExp, keep = 0) {
  const x = vsCli(s, r, vendor, command);
  return { ...x, output: pickLines(x.output, match, keep) };
}
/** One customer ping, as the lab reports it. */
export function PingResult({ s, title }: { s: VsState; title: string }) {
  const t = s.tests[s.tests.length - 1];
  return (
    <Callout tone={t.ok ? "success" : "danger"} title={title} icon={t.ok ? "✓" : "!"}>
      {t.from} → {t.dst}: {t.ok ? `delivered to ${t.reached}, and the reply came back — ${t.flooded ? "some frames flooded" : "every frame unicast"}` : t.why}
    </Callout>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the VPLS Lab" onPractice={openLab}>
      Three PEs bridging one customer LAN, real MAC tables, IOS XR or Junos, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const PE: Record<string, [number, number]> = { PE1: [150, 110], PE2: [480, 45], PE3: [480, 175] };

/** Label position along a PW; a vertical PW gets its labels beside the line, clear of the node boxes. */
function pwLabelPos(x1: number, y1: number, x2: number, y2: number, t: number) {
  if (x1 === x2) return { x: x1 + 8, y: y1 + (y2 - y1) * (t < 0.5 ? 0.32 : 0.68) + 3, textAnchor: "start" as const };
  return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t - 6, textAnchor: "middle" as const };
}

function ServiceMesh({ labels = true, down, highlight }: { labels?: boolean; down?: string; highlight?: string[] }) {
  const pairs: [string, string, string, string][] = [
    ["PE1", "PE2", "24012", "25021"],
    ["PE1", "PE3", "24013", "26031"],
    ["PE2", "PE3", "25023", "26032"],
  ];
  return (
    <>
      {pairs.map(([a, b, la, lb]) => {
        const id = `${a}-${b}`;
        const isDown = down === id;
        const hot = highlight?.includes(id);
        const [x1, y1] = PE[a];
        const [x2, y2] = PE[b];
        return (
          <g key={id}>
            <DLink x1={x1} y1={y1} x2={x2} y2={y2} color={isDown ? D.danger : hot ? D.warning : D.violet} dashed={isDown} />
            {labels && !isDown && (
              <>
                <text {...pwLabelPos(x1, y1, x2, y2, 0.2)} fill={D.muted} fontSize={9} fontFamily="monospace">
                  {la}
                </text>
                <text {...pwLabelPos(x1, y1, x2, y2, 0.8)} fill={D.muted} fontSize={9} fontFamily="monospace">
                  {lb}
                </text>
              </>
            )}
          </g>
        );
      })}
      <DLink x1={60} y1={110} x2={100} y2={110} color={D.ip} />
      <DLink x1={530} y1={45} x2={575} y2={45} color={D.ip} />
      <DLink x1={530} y1={175} x2={575} y2={175} color={D.ip} />
      <DNode x={40} y={110} label="CE1" accent={D.ip} w={50} h={30} />
      <DNode x={600} y={45} label="CE2" accent={D.ip} w={50} h={30} />
      <DNode x={600} y={175} label="CE3" accent={D.ip} w={50} h={30} />
      {Object.entries(PE).map(([id, [x, y]]) => (
        <DNode key={id} x={x} y={y} label={id} sub="VSI" accent={D.mpls} w={90} />
      ))}
    </>
  );
}

function MeshDiagram() {
  return (
    <DiagramSvg h={220} label="PE1, PE2 and PE3 full mesh with receive labels at each end: 24012/25021, 24013/26031, 25023/26032">
      <ServiceMesh />
      <text x={320} y={214} textAnchor="middle" fill={D.muted} fontSize={10}>
        the label printed next to a PE is the one THAT PE advertised and receives on
      </text>
    </DiagramSvg>
  );
}

function LearningDiagram() {
  const col = (x: number, title: string, rows: string[], c: string) => (
    <g>
      <text x={x} y={20} textAnchor="middle" fill={c} fontSize={10.5} fontWeight={700}>
        {title}
      </text>
      {["PE1", "PE2", "PE3"].map((pe, i) => (
        <g key={pe}>
          <rect x={x - 90} y={32 + i * 52} width={180} height={44} rx={8} fill={D.box} stroke={D.line} />
          <text x={x - 82} y={48 + i * 52} fill={D.muted} fontSize={9} fontWeight={700}>
            {pe}
          </text>
          <text x={x - 82} y={64 + i * 52} fill={D.text} fontSize={9} fontFamily="monospace">
            {rows[i] || "—"}
          </text>
        </g>
      ))}
    </g>
  );
  return (
    <DiagramSvg h={200} label="After the first frame all three PEs know CE1; after CE2's reply PE1 and PE2 know both; after the next frame nothing new">
      {col(110, "1 · CE1 → CE2 (flooded)", ["CE1 → AC", "CE1 → PW: PE1", "CE1 → PW: PE1"], D.warning)}
      {col(320, "2 · CE2 → CE1 (direct)", ["CE1 → AC · CE2 → PW: PE2", "CE1 → PW: PE1 · CE2 → AC", "CE1 → PW: PE1"], D.success)}
      {col(530, "3 · CE1 → CE2 (known)", ["no change, one copy", "no change", "sees nothing"], D.cyan)}
    </DiagramSvg>
  );
}

function ReplicaDiagram() {
  return (
    <DiagramSvg h={240} label="PE1 sends one copy to PE2 with 102 over 25021 and one copy to PE3 with 103 over 26031">
      <DNode x={80} y={120} label="PE1" sub="unknown dst" accent={D.mpls} w={100} />
      <DNode x={560} y={50} label="PE2" accent={D.mpls} w={80} />
      <DNode x={560} y={190} label="PE3" accent={D.mpls} w={80} />
      <DArrow x1={132} y1={108} x2={518} y2={54} color={D.warning} />
      <DArrow x1={132} y1={132} x2={518} y2={186} color={D.warning} />
      <DStack x={300} y={4} labels={[{ text: "102 S0" }, { text: "25021 S1", color: D.violet }]} payload="Ethernet" w={82} />
      <DStack x={300} y={170} labels={[{ text: "103 S0" }, { text: "26031 S1", color: D.violet }]} payload="Ethernet" w={82} />
      <text x={420} y={124} fill={D.muted} fontSize={9.5}>
        separate stack per replica
      </text>
    </DiagramSvg>
  );
}

function SplitDiagram() {
  return (
    <DiagramSvg h={220} label="PE2 receives a flooded frame on PW from PE1: it may send to its AC toward CE2 but never out the PW to PE3">
      <ServiceMesh labels={false} highlight={["PE1-PE2"]} />
      <DPill x={480} y={110} text="PE2 → PE3 ✕" color={D.danger} w={110} />
      <text x={416} y={114} textAnchor="end" fill={D.danger} fontSize={10} fontWeight={700}>
        split horizon
      </text>
      <text x={320} y={214} textAnchor="middle" fill={D.muted} fontSize={10}>
        PE3 already got its own copy directly from PE1, so nothing is lost
      </text>
    </DiagramSvg>
  );
}

function FaultDiagram() {
  return (
    <DiagramSvg h={220} label="With PW PE1-PE3 down, PE1 floods only to PE2 and PE2 cannot relay to PE3, so CE3 never receives CE1's frame">
      <ServiceMesh labels={false} down="PE1-PE3" highlight={["PE1-PE2"]} />
      <DPill x={300} y={138} text="PW PE1–PE3 DOWN" color={D.danger} w={130} />
      <DPill x={560} y={110} text="PE2 → PE3 blocked" color={D.danger} w={140} />
    </DiagramSvg>
  );
}

export function VplsLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="pl-mission" eyebrow="This lesson" title="What this lesson teaches" tone="mpls">
        <p>
          Customer A has three sites — CE1, CE2 and CE3 behind PE1, PE2 and PE3 — and wants them on one Ethernet segment, <Mono>192.168.100.0/24</Mono>, as if plugged into the same switch. A VPWS wire has only two ends. This lesson builds a <b className="text-pv-text">Virtual Private LAN Service</b> (VPLS): the PEs become one distributed Ethernet switch, joined by a full mesh of pseudowires.
        </p>
        <p>You will watch the mesh come up, the MAC tables start empty, the first frame flood and the reply teach the bridges where everyone lives. You will see why a frame from one pseudowire may never leave on another — and what happens when one pseudowire of the mesh is missing: CE1 and CE3 lose each other while every other pair works.</p>
        <ChecklistCard
          tone="violet"
          title="By the end of this lesson you can"
          mark="→"
          items={["explain why multipoint Ethernet needs bridging at the PEs", "describe the full mesh and count its pseudowires", "follow MAC learning, flooding and known unicast", "explain split horizon and why it forces a full mesh", "read the six directional labels", "find a missing mesh member from evidence, fix it and prove it"]}
        />
      </GuideSection>

      <GuideSection id="pl-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="Three PEs, three pseudowires; the P routers carry the LSPs underneath.">
          <MeshDiagram />
        </DiagramFrame>
        <FieldTable
          title="Who is who"
          accent="mpls"
          columns={["Site", "MAC", "Attached to"]}
          rows={[
            ["CE1 · 192.168.100.1", <Mono key="1">00:11:11:11:11:11</Mono>, "PE1 (1.1.1.1)"],
            ["CE2 · 192.168.100.2", <Mono key="2">00:22:22:22:22:22</Mono>, "PE2 (2.2.2.2)"],
            ["CE3 · 192.168.100.3", <Mono key="3">00:33:33:33:33:33</Mono>, "PE3 (3.3.3.3)"],
          ]}
        />
        <Callout tone="cyan" title="The lab uses the same network" icon="i">
          P1 (10.10.10.1) connects PE1 to P2 (toward PE2) and P3 (toward PE3); VLAN 100, VPLS ID 500. The guided lesson names the attachment circuits <Mono>ge-0/0/0.100</Mono>; in the lab ge-0/0/0 faces the core, so they are <Mono>ge-0/0/1.100</Mono> — and a fourth site, CE4, waits unconnected on PE2. Every output on this page comes from the lab.
        </Callout>
      </GuideSection>

      <GuideSection id="pl-ideas" eyebrow="This lesson" title="Three ideas you need" tone="violet">
        <CompareCards
          items={[
            { title: "Bridge at each PE", tone: "cyan", tag: "data plane", points: ["ports: the AC and one pseudowire per other PE", "learn, forward, flood"] },
            { title: "Full mesh", tone: "violet", tag: "control plane", points: ["a pseudowire between every pair of PEs", "same VPLS ID everywhere"] },
            { title: "Split horizon", tone: "danger", tag: "loop prevention", points: ["pseudowire → pseudowire is forbidden", "so nobody relays"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="pl-watch" eyebrow="This lesson" title="What you will watch" tone="cyan">
        <FlowSteps
          steps={[
            { title: "The mesh", body: "Three pseudowires, six labels.", tone: "violet" },
            { title: "Empty tables", body: "Nobody knows anybody yet.", tone: "cyan" },
            { title: "Flood", body: "The first frame goes everywhere.", tone: "warning" },
            { title: "Learn", body: "Replies teach the bridges.", tone: "success" },
            { title: "The incident", body: "PE1–PE3 is down; one pair breaks.", tone: "danger" },
            { title: "Repair", body: "Complete the mesh, prove it.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="pl-bridge" eyebrow="Service" title="Each PE is a bridge" tone="violet">
        <p>For this one customer, every PE runs an Ethernet bridge — IOS XR calls it a <b className="text-pv-text">bridge domain</b> (with a <b className="text-pv-text">VFI</b> holding the pseudowires), Junos a routing instance of type <b className="text-pv-text">vpls</b>. Its ports are the local attachment circuit and one pseudowire to every other PE. It forwards by MAC address, nothing else.</p>
        <CliPair cisco={vsCli(VS_HEALTHY, "PE1", "cisco", "show l2vpn bridge-domain")} junos={vsCli(VS_HEALTHY_JN, "PE1", "juniper", "show configuration routing-instances")} ciscoCaption="IOS XR · PE1 — one AC, a VFI with two pseudowires" junosCaption="Junos · PE1 — the VPLS instance: interface, vpls-id, neighbors" />
      </GuideSection>

      <GuideSection id="pl-mesh" eyebrow="Control plane" title="The pseudowire full mesh" tone="violet">
        <p>Every pair of PEs signals its own pseudowire, each over its own targeted LDP session between loopbacks, all with the same PW ID — the <b className="text-pv-text">VPLS ID 500</b>. Three PEs make three pseudowires; N PEs would make N(N−1)/2.</p>
        <CliPair cisco={vsOnly(VS_HEALTHY, "PE1", "cisco", "show mpls ldp discovery", /Targeted|->|LDP Id: [23]/)} junos={vsCli(VS_HEALTHY_JN, "PE1", "juniper", "show ldp neighbor")} ciscoCaption="IOS XR · PE1 — targeted hellos to both other PEs, answered" junosCaption="Junos · PE1 — two targeted neighbors on lo0.0" />
      </GuideSection>

      <GuideSection id="pl-labels" eyebrow="Control plane" title="Six directional labels" tone="mpls">
        <p>Each PE allocates one receive label per neighbor, and the neighbor pushes it. Because the label differs per neighbor, the receiving PE knows which pseudowire — which bridge port — a frame arrived on, which is exactly what MAC learning and split horizon need.</p>
        <FieldTable
          title="Receive labels (IOS XR numbering, the guided lesson's)"
          accent="mpls"
          columns={["PE", "from PE1", "from PE2", "from PE3"]}
          rows={[
            ["PE1", "—", <Mono key="1">24012</Mono>, <Mono key="2">24013</Mono>],
            ["PE2", <Mono key="3">25021</Mono>, "—", <Mono key="4">25023</Mono>],
            ["PE3", <Mono key="5">26031</Mono>, <Mono key="6">26032</Mono>, "—"],
          ]}
        />
        <DiagramFrame caption="Flooding: one replica per pseudowire, each with that neighbor's label.">
          <ReplicaDiagram />
        </DiagramFrame>
        <Callout tone="cyan" title="The numbers on this page" icon="i">
          The PW labels are the same in the guided lesson and the lab. For transport the guided lesson uses short labels (P1 = 102 toward PE2, 103 toward PE3); the lab allocates like IOS XR: P1 = 24103 and 24104, P2 = 24204, P3 = 24306. Junos numbers everything from 299776.
        </Callout>
        <CliPanel run={vsOnly(VS_HEALTHY, "PE1", "cisco", "show l2vpn bridge-domain detail", /PW: neighbor|MPLS  |Label  /)} caption="IOS XR · PE1 — receives on 24012 / 24013, pushes 25021 / 26031" />
      </GuideSection>

      <GuideSection id="pl-learn" eyebrow="Data plane" title="Learning and flooding" tone="warning">
        <DiagramFrame caption="A PE learns the source MAC on the port the frame arrived on.">
          <LearningDiagram />
        </DiagramFrame>
        <p>The tables start empty. CE1 broadcasts an ARP request for 192.168.100.3. PE1 learns CE1&apos;s MAC on its attachment circuit and floods the broadcast over both pseudowires; PE2 and PE3 learn CE1 behind their pseudowire to PE1 and deliver it locally. CE3&apos;s reply is unicast — PE3 already knows where CE1 is — so PE1 learns CE3 behind PE3, and PE2 never hears of CE3.</p>
        <CliPair cisco={vsCli(VS_LEARNED, "PE1", "cisco", "show l2vpn forwarding bridge-domain mac-address location 0/0/CPU0")} junos={vsCli(VS_LEARNED_JN, "PE1", "juniper", "show vpls mac-table")} ciscoCaption="IOS XR · PE1 after one ping — CE1 on the AC, CE3 behind (3.3.3.3, 500)" junosCaption="Junos · PE1 — CE3 behind the lsi interface toward PE3" />
        <CliPanel run={vsOnly(VS_LEARNED, "PE2", "cisco", "show l2vpn forwarding bridge-domain mac-address location 0/0/CPU0", /Mac Address|----|dynamic/)} caption="IOS XR · PE2 — only CE1: CE3's reply never passed here" />
      </GuideSection>

      <GuideSection id="pl-known" eyebrow="Data plane" title="Known unicast" tone="success">
        <p>Ping again: CE1 has CE3 in its ARP cache and PE1 knows CE3 is behind PE3, so every frame goes over that one pseudowire. Flooding is how a VPLS discovers; learning is how it stops.</p>
        <PingResult s={VS_LEARNED} title="The lab: the first ping CE1 → CE3" />
        <PingResult s={VS_AGAIN} title="The lab: the same ping again" />
      </GuideSection>

      <GuideSection id="pl-split" eyebrow="Loop prevention" title="Split horizon" tone="danger">
        <DiagramFrame caption="A frame from a pseudowire goes only to local attachment circuits.">
          <SplitDiagram />
        </DiagramFrame>
        <p>The three pseudowires form a triangle. If PE2 forwarded PE1&apos;s broadcast to PE3 and PE3 back to PE1, the frame would circle forever — Ethernet has no TTL. So a frame received on a pseudowire is <b className="text-pv-text">never</b> sent out another pseudowire. Nobody relays; therefore every PE needs a direct pseudowire to every other PE — the full mesh.</p>
      </GuideSection>

      <GuideSection id="pl-aging" eyebrow="Operations" title="Aging and moves" tone="cyan">
        <CompareCards
          items={[
            { title: "Aging", tone: "cyan", tag: "300 s", points: ["entries not refreshed by traffic expire", "the next frame floods and relearns", "clear: clear l2vpn bridge-domain bd-name … / clear vpls mac-table instance …"] },
            { title: "A host moves", tone: "warning", tag: "relearn", points: ["the old entry points to the old site", "the PEs relearn when the host sends from its new port", "LDP MAC withdrawal can flush faster; EVPN signals moves"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="pl-working" eyebrow="Evidence" title="What working looks like" tone="success">
        <FieldTable
          title="Healthy, in five questions"
          accent="success"
          columns={["Question", "IOS XR", "Healthy answer"]}
          rows={[
            ["Is every site's AC in the bridge?", <Mono key="1">show l2vpn bridge-domain detail</Mono>, "AC up, VLAN ranges [100, 100]"],
            ["Does every PE list every other PE?", <Mono key="2">show l2vpn bridge-domain</Mono>, "two neighbors, pw-id 500"],
            ["Is every pseudowire up?", <Mono key="3">show l2vpn bridge-domain</Mono>, "PWs: 2 (2 up) on each PE"],
            ["Are MACs learned where expected?", <Mono key="4">show l2vpn forwarding bridge-domain mac-address location 0/0/CPU0</Mono>, "local CE on the AC, the others behind their PE"],
            ["Does every pair of sites work?", "fresh pings", "CE1↔CE2, CE1↔CE3, CE2↔CE3"],
          ]}
        />
      </GuideSection>

      <GuideSection id="pl-incident" eyebrow="Incident" title="The incident" tone="danger">
        <DiagramFrame caption="PE1–PE3 is down; PE2 holds the other two pseudowires and may not relay.">
          <FaultDiagram />
        </DiagramFrame>
        <p>After a cleanup of PE3&apos;s configuration, CE1 can&apos;t reach CE3. CE1 ↔ CE2 and CE2 ↔ CE3 work, so &quot;the VPLS is up&quot;.</p>
        <PingResult s={VS_FAULT} title="The lab: CE1 pings 192.168.100.3 (the ticket)" />
        <PingResult s={VS_FAULT_OK} title="The lab: CE1 pings 192.168.100.2 — still fine" />
      </GuideSection>

      <GuideSection id="pl-investigate" eyebrow="Incident" title="Walk the evidence" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Which pairs fail?", look: "Only CE1 ↔ CE3." },
            { question: "Are the attachment circuits in the bridge?", look: "Yes, on all three PEs." },
            { question: "Does every PE list every other PE?", look: "PE3 lists only 2.2.2.2." },
            { question: "What happens to the PE1–PE3 pseudowire?", look: "No targeted session: PE1's hellos to 3.3.3.3 go unanswered." },
          ]}
        />
        <CliPanel run={vsOnly(VS_FAULT, "PE3", "cisco", "show l2vpn bridge-domain", /ACs: d|VFI VPLS|Neighbor/)} caption="IOS XR · PE3 — one neighbor only: 2.2.2.2" />
        <CliPanel run={vsOnly(VS_FAULT, "PE1", "cisco", "show mpls ldp discovery", /Targeted|->/)} caption="IOS XR · PE1 — hellos to 3.3.3.3 sent, never answered" />
        <CliPanel run={vsOnly(VS_FAULT_JN, "PE1", "juniper", "show vpls connections", /Instance|VPLS-id|Neighbor  |vpls-id 500\)/)} caption="Junos · PE1 — 3.3.3.3: OL, no outgoing label" />
      </GuideSection>

      <GuideSection id="pl-fix" eyebrow="Incident" title="Repair and prove it" tone="success">
        <CliPair cisco={{ prompt: "RP/0/RP0/CPU0:PE3(config)#", command: "l2vpn", output: "RP/0/RP0/CPU0:PE3(config-l2vpn)#bridge group CUST-A\nRP/0/RP0/CPU0:PE3(config-l2vpn-bg)#bridge-domain VPLS-A\nRP/0/RP0/CPU0:PE3(config-l2vpn-bg-bd)#vfi VPLS-A\nRP/0/RP0/CPU0:PE3(config-l2vpn-bg-bd-vfi)#neighbor 1.1.1.1 pw-id 500\nRP/0/RP0/CPU0:PE3(config-l2vpn-bg-bd-vfi-pw)#commit" }} junos={{ prompt: "admin@PE3# ", command: "set routing-instances VPLS-A protocols vpls neighbor 1.1.1.1", output: "\n[edit]\nadmin@PE3# commit and-quit\ncommit complete\nExiting configuration mode" }} ciscoCaption="IOS XR · PE3" junosCaption="Junos · PE3" />
        <PingResult s={VS_FIXED} title="The lab: a fresh ping after the fix" />
        <ChecklistCard tone="success" title="Proved, not assumed" mark="✓" items={["PE3 lists both 1.1.1.1 and 2.2.2.2; all six pseudowire ends are up", "a fresh ping from CE1 reaches CE3 directly over PE1–PE3"]} />
      </GuideSection>

      <GuideSection id="pl-other" eyebrow="Beyond this incident" title="Other ways a VPLS fails" tone="warning">
        <FailureSignatures
          items={[
            { tag: "ID", title: "Different VPLS ID", tone: "danger", points: ["one PE's pseudowires down", "that site isolated"] },
            { tag: "MTU", title: "Different MTU", tone: "danger", points: ["remote labels known", "that PE's pseudowires down"] },
            { tag: "VLAN", title: "AC on the wrong VLAN", tone: "violet", points: ["every pseudowire up", "one site silent"] },
            { tag: "LSP", title: "Transport broken", tone: "warning", points: ["XR: PWs up, drops in the core", "Junos: PWs down"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Each is a ticket in the VPLS Lab, together with this incident.</p>
      </GuideSection>

      <GuideSection id="pl-model" eyebrow="Mental model" title="Mental model" tone="cyan">
        <p>
          Picture three office buildings, each with a receptionist (the PE) and direct phone lines to the other two receptionists (the full mesh). A visitor&apos;s envelope arrives addressed to someone: if the receptionist knows which building that person is in, it goes down that one line; if not, a copy goes down every line (flooding) — and every receptionist notes who sent what from where (learning). One rule keeps the envelopes from circling: a receptionist never passes an envelope that came in on one line out on another line (split horizon). So if the line between building 1 and building 3 is cut, nobody in building 2 will bridge the gap — buildings 1 and 3 simply can&apos;t reach each other.
        </p>
        <Callout tone="cyan" title="When it breaks, ask in this order" icon="→">
          Which pairs of sites fail? Is every site&apos;s attachment circuit in the bridge? Does every PE list every other PE? Is every pseudowire up — same VPLS ID and MTU? Is the transport LSP complete?
        </Callout>
      </GuideSection>

      <GuideSection id="pl-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "VPLS", def: "Virtual Private LAN Service: multipoint Ethernet over an MPLS network." },
            { term: "Bridge domain / VSI", def: "The per-customer Ethernet bridge on a PE (IOS XR bridge domain; Junos VPLS instance)." },
            { term: "VFI", def: "IOS XR's virtual forwarding instance: the bridge domain's set of mesh pseudowires." },
            { term: "VPLS ID", def: "The PW ID every pseudowire of the VPLS uses (LDP-signaled VPLS)." },
            { term: "Full mesh", def: "A pseudowire between every pair of PEs: N(N−1)/2 of them." },
            { term: "Split horizon", def: "A frame received on a mesh pseudowire is never sent out another one." },
            { term: "BUM", def: "Broadcast, unknown unicast and multicast: the traffic a bridge floods." },
            { term: "MAC aging", def: "Learned entries expire when not refreshed by traffic (300 s by default)." },
          ]}
        />
      </GuideSection>

      <GuideSection id="pl-recap" eyebrow="Reference" title="Recap" tone="success">
        <ChecklistCard tone="success" title="You can now" mark="✓" items={["explain why VPLS bridges at the PEs", "count and read the pseudowire mesh", "follow learning, flooding and known unicast", "explain split horizon and the full mesh", "read the directional labels", "find, fix and prove a missing mesh member"]} />
      </GuideSection>

      <GuideSection id="pl-practice" eyebrow="Next" title="Practice it" tone="violet">
        <p>The Deep Dive tab covers VPLS in full: the VSI and bridge domain, the cost of the full mesh, LDP signaling, the forwarding decision, BUM replication, loops and split horizon, aging and MAC moves, scaling limits, IOS XR and Junos configuration, and every failure signature with real evidence. The lab lets you operate it.</p>
        <LessonLabBridge />
        <PresentationBridge>Rewatch the VPLS presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
