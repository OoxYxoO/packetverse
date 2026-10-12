import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, FailureSignatures, FieldTable, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { hex4 } from "@/lib/sim-engine/scenarios/fundamentalsPackets";
import { L2_IP, L2_PORTS, MGMT, MGMT_VLAN, USER_VLAN, stpState, tci } from "@/lib/sim-engine/scenarios/troubleshootingLayer2";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import { createL2Net, l2Apply, l2Ticket, l2TicketState, testText, type L2Action, type L2D, type L2State, type L2TicketId } from "@/lib/sim-engine/scenarios/l2Net";
import { l2Sets, l2StaticApi } from "./l2-lab/l2Cli";

export const L2_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "l2l-mission", label: "What this lesson teaches" },
  { id: "l2l-network", label: "The network of this lesson" },
  { id: "l2l-ideas", label: "Three ideas you need" },
  { id: "l2l-watch", label: "What you will watch" },
  { id: "l2l-learning", label: "How a switch learns" },
  { id: "l2l-vlans", label: "Access ports and trunks" },
  { id: "l2l-tag", label: "The 802.1Q tag" },
  { id: "l2l-stp", label: "The spanning tree" },
  { id: "l2l-pipeline", label: "One frame, one switch" },
  { id: "l2l-working", label: "What working looks like" },
  { id: "l2l-incident", label: "The VLAN 10 incident" },
  { id: "l2l-follow", label: "Follow the frame" },
  { id: "l2l-tables", label: "What the tables say" },
  { id: "l2l-trunk", label: "The trunk, both ends" },
  { id: "l2l-repair", label: "Repair and proof" },
  { id: "l2l-other", label: "Other ways it breaks" },
  { id: "l2l-model", label: "Mental model" },
  { id: "l2l-glossary", label: "Glossary" },
  { id: "l2l-recap", label: "Recap" },
  { id: "l2l-practice", label: "Practice it" },
];

/** Real Junos and Linux output on this page comes from the Layer 2 Lab. */
const run = (s: L2State, ...a: L2Action[]) => a.reduce((acc, x) => l2Apply(acc, x), s);
export const l2TicketRun = (id: L2TicketId) => l2Ticket(id).repro.reduce((acc, a) => l2Apply(acc, a), l2TicketState(id, 1));
export const pAB: L2Action = { type: "ping", from: "HOST-A", to: L2_IP["HOST-B"], count: 4 };
export const L2G = run(createL2Net(0), pAB, { type: "ping", from: "SW1", to: MGMT.SW3.ip, count: 4 });
export const L2_INC = l2TicketRun("prune");
export const L2_FIX = run(L2_INC, { type: "set", text: "SW2: vlan members USERS on ge-0/0/51", f: (s) => void (s.cfg.SW2.ports["ge-0/0/51"].members = [USER_VLAN, MGMT_VLAN]) }, pAB);
export function l2Cli(s: L2State, d: L2D, command: string) {
  return runGuideCli(l2Sets(l2StaticApi(s, d), d).juniper, command);
}
export function l2Only(s: L2State, d: L2D, command: string, match: RegExp, keep = 0) {
  const x = l2Cli(s, d, command);
  return { ...x, output: pickLines(x.output, match, keep) };
}
/** Tests as the lab reports them (from test `from` on). */
export function L2Result({ s, title, from = 0 }: { s: L2State; title: string; from?: number }) {
  const ts = s.tests.slice(from);
  const ok = ts.every((t) => t.recv === t.sent && !t.storm);
  return (
    <Callout tone={ok ? "success" : "danger"} title={title} icon={ok ? "✓" : "!"}>
      {ts.map(testText).join(" · ")}
    </Callout>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the Layer 2 Lab" onPractice={openLab}>
      The lesson&apos;s triangle live: every port&apos;s VLANs and spanning-tree role, all three MAC tables, pings in VLAN 10 and 20, Junos EX and Linux consoles — your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

function TopologyDiagram() {
  return (
    <DiagramSvg h={250} label="HOST-A on SW1; SW1, SW2 and SW3 in a triangle of trunks; HOST-B on SW3; RSTP root SW2; SW1's port toward SW3 is Alternate and discarding">
      <DNode x={320} y={26} label="HOST-A" sub={`${L2_IP["HOST-A"]} · VLAN 10`} accent={D.cyan} w={150} />
      <DNode x={320} y={96} label="SW1" sub="prio 32768" accent={D.eth} w={110} />
      <DNode x={150} y={172} label="SW2" sub="root · prio 4096" accent={D.violet} w={130} />
      <DNode x={490} y={172} label="SW3" sub="prio 8192" accent={D.eth} w={110} />
      <DNode x={490} y={232} label="HOST-B" sub={`${L2_IP["HOST-B"]} · VLAN 10`} accent={D.success} w={150} h={34} />
      <DLink x1={320} y1={48} x2={320} y2={74} />
      <DLink x1={280} y1={112} x2={190} y2={150} color={D.success} label="ge-0/0/49" labelDy={-4} />
      <DLink x1={362} y1={112} x2={450} y2={150} color={D.faint} dashed label="ge-0/0/50 · SW1 Alternate" labelDy={-4} />
      <DLink x1={215} y1={172} x2={435} y2={172} color={D.success} label="ge-0/0/51" />
      <DLink x1={490} y1={194} x2={490} y2={215} />
      <DPill x={110} y={232} text="active path: SW1 → SW2 → SW3" color={D.success} w={200} />
    </DiagramSvg>
  );
}

function AccessTrunkDiagram() {
  return (
    <DiagramSvg h={140} label="A VLAN 10 frame is untagged on HOST-A's access port, tagged VID 10 on each trunk, and untagged again on HOST-B's access port">
      {[
        { x: 70, t: "HOST-A → SW1", s: "untagged", c: D.eth },
        { x: 250, t: "SW1 → SW2", s: "tag VID 10", c: D.violet },
        { x: 410, t: "SW2 → SW3", s: "tag VID 10", c: D.violet },
        { x: 570, t: "SW3 → HOST-B", s: "untagged", c: D.eth },
      ].map((h) => (
        <g key={h.t}>
          <DPill x={h.x} y={50} text={h.s} color={h.c} w={110} />
          <text x={h.x} y={80} textAnchor="middle" fill={D.muted} fontSize={9} fontFamily="monospace">
            {h.t}
          </text>
        </g>
      ))}
      <DArrow x1={128} y1={50} x2={192} y2={50} color={D.muted} width={1.4} />
      <DArrow x1={308} y1={50} x2={352} y2={50} color={D.muted} width={1.4} />
      <DArrow x1={468} y1={50} x2={512} y2={50} color={D.muted} width={1.4} />
      <text x={320} y={118} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Access ports carry one VLAN untagged (PVID). Trunks carry many VLANs, each frame tagged with its VLAN ID.
      </text>
    </DiagramSvg>
  );
}

function TagDiagram() {
  const f = (label: string, sub: string, w: number, color: string, strong?: boolean) => ({ label, sub, w, color, strong });
  return (
    <DiagramSvg h={150} label={`802.1Q tag inserted after the source MAC: TPID 0x8100, then TCI with PCP, DEI and a 12-bit VID; VID 10 is TCI ${hex4(tci(10))}`}>
      <DFieldRow x={20} y={14} fields={[f("Dst MAC", "6 B", 80, D.eth), f("Src MAC", "6 B", 80, D.eth), f("TPID", "0x8100", 80, D.violet, true), f("PCP", "3 b · 0", 60, D.violet), f("DEI", "1 b · 0", 60, D.violet), f("VID", `12 b · ${USER_VLAN}`, 90, D.violet, true), f("EtherType", "0x0800", 80, D.eth), f("…", "payload + FCS", 70, D.faint)]} />
      <text x={320} y={92} textAnchor="middle" fill={D.text} fontSize={10.5} fontFamily="monospace" fontWeight={700}>
        TCI = PCP·DEI·VID = {hex4(tci(USER_VLAN))} for VLAN {USER_VLAN} · {hex4(tci(MGMT_VLAN))} for VLAN {MGMT_VLAN}
      </text>
      <text x={320} y={114} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        4 bytes added on a trunk; the FCS is recomputed whenever the tag is added or removed.
      </text>
    </DiagramSvg>
  );
}

function MacBaseline() {
  return (
    <DiagramSvg h={130} label="Baseline VLAN 10 MAC tables: every switch knows HOST-A and HOST-B, on the ports toward them along the tree">
      <DTable
        x={60}
        y={8}
        title="Baseline MAC tables, VLAN 10"
        cols={[
          { label: "SWITCH", w: 120 },
          { label: "HOST-A →", w: 200 },
          { label: "HOST-B →", w: 200 },
        ]}
        rows={[
          ["SW1", "ge-0/0/1 (access)", "ge-0/0/49 (to SW2)"],
          ["SW2", "ge-0/0/49 (to SW1)", "ge-0/0/51 (to SW3)"],
          ["SW3", "ge-0/0/51 (to SW2)", "ge-0/0/1 (access)"],
        ]}
      />
    </DiagramSvg>
  );
}

function PipelineDiagram() {
  const stages = ["receive", "classify", "ingress chk", "learn src", "lookup dst", "egress chk", "tag / drop"];
  return (
    <DiagramSvg h={110} label="Bridging pipeline: receive, classify VLAN, ingress filter, learn source MAC, look up destination, check egress VLAN membership and STP state, then tag, untag or drop">
      {stages.map((t, i) => {
        const x = 56 + i * 88;
        return (
          <g key={t}>
            <DPill x={x} y={40} text={t} color={i === 5 ? D.warning : D.cyan} w={80} />
            {i < stages.length - 1 && <DArrow x1={x + 40} y1={40} x2={x + 48} y2={40} color={D.muted} width={1.2} />}
          </g>
        );
      })}
      <text x={320} y={86} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Egress check = is the VLAN permitted on that port, and is the port RSTP-forwarding? Ingress check = is the VLAN accepted on arrival?
      </text>
    </DiagramSvg>
  );
}

function DropDiagram() {
  return (
    <DiagramSvg h={190} label="SW2's pipeline for HOST-A's echo: accepted on ge-0/0/49, HOST-B known on ge-0/0/51, but VLAN 10 not in ge-0/0/51's egress permitted set, so dropped">
      <DTable
        x={30}
        y={8}
        title="SW2, echo from HOST-A to HOST-B (VLAN 10)"
        cols={[
          { label: "STAGE", w: 160 },
          { label: "RESULT", w: 420 },
        ]}
        rows={[
          ["Classify / ingress", "VID 10 on ge-0/0/49 (allowed 10, 20) → accepted"],
          ["Learn", "HOST-A → ge-0/0/49"],
          ["Lookup", "HOST-B known → ge-0/0/51  (not an unknown MAC)"],
          ["Egress check", "VLAN 10 not in ge-0/0/51's egress permitted set (allowed 20)"],
          ["Transmit", "no egress port remains → dropped"],
        ]}
        highlight={{ row: 3, color: D.danger }}
      />
    </DiagramSvg>
  );
}

function OtherVlanDiagram() {
  return (
    <DiagramSvg h={140} label="Across the same SW2 to SW3 trunk, VLAN 20 frames pass while VLAN 10 frames are dropped at SW2's egress">
      <DNode x={130} y={70} label="SW2" sub="ge-0/0/51" accent={D.violet} w={110} h={60} />
      <DNode x={510} y={70} label="SW3" sub="ge-0/0/51" accent={D.eth} w={110} h={60} />
      <DArrow x1={188} y1={55} x2={452} y2={55} color={D.success} />
      <text x={320} y={47} textAnchor="middle" fill={D.success} fontSize={9.5} fontFamily="monospace">
        VID 20 (management) — 5/5
      </text>
      <DArrow x1={188} y1={88} x2={280} y2={88} color={D.danger} />
      <text x={284} y={93} fill={D.danger} fontSize={13} fontWeight={800}>
        ✕
      </text>
      <text x={302} y={93} fill={D.danger} fontSize={9.5} fontFamily="monospace">
        VID 10 — not permitted out
      </text>
      <text x={320} y={128} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Same cable, same ports, same RSTP state — a per-VLAN difference points at membership.
      </text>
    </DiagramSvg>
  );
}

function AgingDiagram() {
  return (
    <DiagramSvg h={130} label="After 300 seconds of aging: SW1 and SW2 no longer know HOST-B, SW3 no longer knows HOST-A">
      <DTable
        x={60}
        y={8}
        title="VLAN 10 MAC tables after aging (300 s)"
        cols={[
          { label: "SWITCH", w: 120 },
          { label: "HOST-A →", w: 200 },
          { label: "HOST-B →", w: 200 },
        ]}
        rows={[
          ["SW1", "ge-0/0/1", "— (aged out)"],
          ["SW2", "ge-0/0/49", "— (aged out)"],
          ["SW3", "— (aged out)", "ge-0/0/1"],
        ]}
        highlight={{ row: 1, color: D.warning }}
      />
    </DiagramSvg>
  );
}

function BothEndsDiagram() {
  return (
    <DiagramSvg h={130} label="The two ends of the SW2 to SW3 trunk disagree: SW2 ge-0/0/51 allows VLAN 20 only, SW3 ge-0/0/51 allows 10 and 20; native VLAN 1 on both">
      <DTable
        x={60}
        y={8}
        title="SW2 ↔ SW3 trunk, both ends (incident)"
        cols={[
          { label: "PORT", w: 160 },
          { label: "ALLOWED", w: 110 },
          { label: "NATIVE", w: 90 },
          { label: "RSTP", w: 160 },
        ]}
        rows={[
          ["SW2 ge-0/0/51", "20", "1", `${L2_PORTS[4].role} / ${stpState(L2_PORTS[4])}`],
          ["SW3 ge-0/0/51", "10, 20", "1", `${L2_PORTS[6].role} / ${stpState(L2_PORTS[6])}`],
        ]}
        highlight={{ row: 0, color: D.danger }}
      />
    </DiagramSvg>
  );
}

function VerifyDiagram() {
  return (
    <DiagramSvg h={150} label="Before and after: SW2 ge-0/0/51 allowed 20 to 10 and 20, ping 0 of 5 to 5 of 5, MAC tables asymmetric to symmetric, RSTP unchanged">
      <DTable
        x={40}
        y={8}
        title="Same tests, before and after"
        cols={[
          { label: "CHECK", w: 200 },
          { label: "INCIDENT", w: 160 },
          { label: "AFTER REPAIR", w: 200 },
        ]}
        rows={[
          ["SW2 ge-0/0/51 allowed", "20", "10, 20"],
          ["HOST-A → HOST-B", "0/5", "5/5"],
          ["VLAN 10 MAC tables", "asymmetric", "symmetric (baseline)"],
          ["RSTP roles / states", "unchanged", "unchanged"],
        ]}
        highlight={{ row: 1, color: D.success }}
      />
    </DiagramSvg>
  );
}


const T = { access: run(l2TicketRun("access"), { type: "ping", from: "HOST-B", to: L2_IP["HOST-A"], count: 1 }), native: l2TicketRun("native"), loop: l2TicketRun("loop"), trunkmode: l2TicketRun("trunkmode") };

export function L2LessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="l2l-mission" eyebrow="This lesson" title="What this lesson teaches" tone="cyan">
        <p>
          Switching problems hide well: every link is up, every light is green, and still two hosts on the same VLAN can&apos;t see each other — or the whole network crawls. The evidence is in the switches&apos; own tables: which MAC was learned where, which VLANs each port carries, how spanning tree has shaped the topology. This lesson answers: <b className="text-pv-text">how do you follow a frame through switches and find exactly where Layer 2 stops it?</b>
        </p>
        <p>You will see how switches learn and flood, how VLANs, access ports and trunks keep broadcast domains apart, how the 802.1Q tag works, and how spanning tree turns a triangle of switches into a loop-free tree. Then you will chase the guided lesson&apos;s incident — VLAN 10 stops at one trunk while everything looks up — and prove the repair with fresh traffic.</p>
        <ChecklistCard tone="cyan" title="By the end of this lesson you can" mark="→" items={["read a MAC table and say how each entry got there", "tell access from trunk ports, tagged from untagged frames", "read spanning-tree roles and explain the blocked port", "follow a broadcast hop by hop and find where it stops", "locate a missing VLAN, a wrong native VLAN, a mode mismatch and a loop", "prove a Layer 2 repair with fresh traffic and the tables it builds"]} />
      </GuideSection>

      <GuideSection id="l2l-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="The guided lesson's triangle.">
          <TopologyDiagram />
        </DiagramFrame>
        <p>
          HOST-A (<Mono>{L2_IP["HOST-A"]}</Mono>) plugs into SW1, HOST-B (<Mono>{L2_IP["HOST-B"]}</Mono>) into SW3 — both in VLAN {USER_VLAN} (USERS). The three switches are joined by trunks carrying VLAN {USER_VLAN} and VLAN {MGMT_VLAN} (MGMT, the switches&apos; own management addresses <Mono>10.20.20.1–3</Mono>). RSTP makes SW2 the root.
        </p>
        <Callout tone="cyan" title="The lesson and the lab" icon="i">
          The guided lesson walks the incident on these five devices. The lab runs the same network live with real Junos EX (ELS) switching commands — <Mono>show ethernet-switching table</Mono>, <Mono>show vlans</Mono>, <Mono>show spanning-tree interface</Mono> — and Linux hosts. Its spanning tree is computed from the configured priorities, its MAC tables are built by the frames you send, and you can break and repair VLANs, natives and spanning tree yourself. Outputs below come from the lab.
        </Callout>
      </GuideSection>

      <GuideSection id="l2l-ideas" eyebrow="This lesson" title="Three ideas you need" tone="violet">
        <CompareCards
          items={[
            { title: "Learn, flood, forward", tone: "cyan", tag: "MAC table", points: ["source MAC → ingress port", "unknown and broadcast: flood in the VLAN"] },
            { title: "VLANs on ports", tone: "violet", tag: "802.1Q", points: ["access: one VLAN, untagged", "trunk: member VLANs, tagged"] },
            { title: "One tree", tone: "success", tag: "RSTP", points: ["a root, a root port each", "one blocked port per loop"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="l2l-watch" eyebrow="This lesson" title="What you will watch" tone="cyan">
        <TroubleshootingFlow
          steps={[
            { question: "A healthy ping", look: `${testText(L2G.tests[0])}; every switch learns both hosts` },
            { question: "The incident", look: `${testText(L2_INC.tests[0])} — while ${testText(L2_INC.tests[1])}` },
            { question: "Follow the frame", look: "the ARP reaches SW2 and is never sent toward SW3" },
            { question: "The tables", look: "SW2 knows HOST-A, SW3 never learns it; SW2 ge-0/0/51 carries MGMT only" },
            { question: "Repair and proof", look: "add USERS to SW2 ge-0/0/51 → 4/4, SW3 learns HOST-A on ge-0/0/51" },
          ]}
        />
      </GuideSection>

      <GuideSection id="l2l-learning" eyebrow="Healthy" title="How a switch learns" tone="cyan">
        <DiagramFrame caption="The guided lesson's baseline MAC tables.">
          <MacBaseline />
        </DiagramFrame>
        <p>
          A switch reads the <b className="text-pv-text">source</b> MAC of every frame it receives and records <i>VLAN + MAC → ingress port</i>. To forward, it looks up the <b className="text-pv-text">destination</b> MAC: known → that one port; unknown or broadcast → every other forwarding port in the same VLAN (flooding). HOST-A&apos;s first frame is an ARP broadcast, so it teaches every switch on its way where HOST-A lives; HOST-B&apos;s reply teaches them the way back. Entries age out after 300 s without traffic.
        </p>
        <CliPanel run={l2Only(L2G, "SW3", "show ethernet-switching table", /Ethernet switching table|USERS/)} caption="Junos · SW3 — HOST-A learned on ge-0/0/51 (from SW2), HOST-B on ge-0/0/1" />
        <CliPanel run={l2Only(L2G, "SW1", "show ethernet-switching table", /Ethernet switching table|USERS/)} caption="Junos · SW1 — HOST-B learned on ge-0/0/49, toward the root" />
      </GuideSection>

      <GuideSection id="l2l-vlans" eyebrow="Healthy" title="Access ports and trunks" tone="violet">
        <DiagramFrame caption="The guided lesson's access–trunk–access journey.">
          <AccessTrunkDiagram />
        </DiagramFrame>
        <p>
          A VLAN is a separate broadcast domain on the same switches. An <b className="text-pv-text">access port</b> belongs to one VLAN and carries its frames untagged — the host never sees a tag. A <b className="text-pv-text">trunk</b> carries several VLANs between switches, each frame tagged with its VLAN ID, plus one <b className="text-pv-text">native VLAN</b> sent untagged (VLAN 1 here, unused by the hosts).
        </p>
        <CliPanel run={l2Cli(L2G, "SW2", "show ethernet-switching interface ge-0/0/51")} caption="Junos · SW2 ge-0/0/51 — USERS and MGMT tagged, native default untagged" />
        <CliPanel run={l2Only(L2G, "SW3", "show vlans", /VLAN name|USERS|MGMT|ge-0\/0\/1\.0|irb/)} caption="Junos · SW3 — VLAN members (* = up and forwarding)" />
      </GuideSection>

      <GuideSection id="l2l-tag" eyebrow="Healthy" title="The 802.1Q tag" tone="ip">
        <DiagramFrame caption="The guided lesson's tag layout.">
          <TagDiagram />
        </DiagramFrame>
        <p>The tag is 4 bytes inserted after the source MAC: TPID <Mono>0x8100</Mono>, then the TCI — 3 bits of priority, 1 drop-eligible bit and the 12-bit VLAN ID. VLAN {USER_VLAN} with priority 0 gives TCI <Mono>{hex4(tci(USER_VLAN))}</Mono>. A trunk adds the tag on egress and removes it on the access port at the far end.</p>
      </GuideSection>

      <GuideSection id="l2l-stp" eyebrow="Healthy" title="The spanning tree" tone="success">
        <p>
          Three switches in a triangle form a loop, and Ethernet frames have no TTL — a broadcast would circle forever. RSTP elects the bridge with the lowest priority as <b className="text-pv-text">root</b> (SW2, 4096), gives each other switch one <b className="text-pv-text">root port</b> toward it, and on the remaining link the side with the worse path discards: SW1 <Mono>ge-0/0/50</Mono> is <b className="text-pv-text">Alternate</b>. So HOST-A&apos;s frames to HOST-B go SW1 → SW2 → SW3.
        </p>
        <CliPanel run={l2Cli(L2G, "SW1", "show spanning-tree interface")} caption="Junos · SW1 — ge-0/0/49 ROOT (forwarding), ge-0/0/50 ALT (blocking)" />
        <CliPanel run={l2Only(L2G, "SW1", "show spanning-tree bridge", /Root ID|Root cost|Root port|Bridge ID/)} caption="Junos · SW1 — root SW2, cost 20000 via ge-0/0/49" />
        <p className="text-sm text-pv-text-muted">Guided lesson&apos;s roles: {L2_PORTS.filter((p) => p.mode === "trunk").map((p) => `${p.sw} ${p.port} ${p.role} (${stpState(p)})`).join(" · ")}.</p>
      </GuideSection>

      <GuideSection id="l2l-pipeline" eyebrow="Healthy" title="One frame, one switch" tone="cyan">
        <DiagramFrame caption="The guided lesson's bridging pipeline.">
          <PipelineDiagram />
        </DiagramFrame>
        <p>Every switch runs the same steps for every frame: classify it into a VLAN (port VLAN, or the tag, or the native VLAN), refuse it if the port doesn&apos;t carry that VLAN, learn the source, look up the destination, then send it out of each chosen port that carries the VLAN <i>and</i> is forwarding in spanning tree — tagged on trunks, untagged on access ports. A frame can disappear at any of those steps without an error message.</p>
      </GuideSection>

      <GuideSection id="l2l-working" eyebrow="Evidence" title="What working looks like" tone="success">
        <FieldTable
          title="Healthy, in five questions"
          accent="success"
          columns={["Question", "Where", "Healthy answer"]}
          rows={[
            ["Do the hosts reach each other?", <Mono key="1">ping on HOST-A</Mono>, "4/4"],
            ["Is every link up?", <Mono key="2">show interfaces terse</Mono>, "up / up"],
            ["One blocked port, root SW2?", <Mono key="3">show spanning-tree interface</Mono>, "SW1 ge-0/0/50 ALT, everything else forwarding"],
            ["Does every switch know both hosts?", <Mono key="4">show ethernet-switching table</Mono>, "HOST-A and HOST-B in USERS on the ports along the tree"],
            ["Does every trunk carry VLAN 10 the same way?", <Mono key="5">show ethernet-switching interface</Mono>, "USERS tagged, MGMT tagged, native 1 at both ends"],
          ]}
        />
        <L2Result s={L2G} title="The lab: the healthy baseline" />
      </GuideSection>

      <GuideSection id="l2l-incident" eyebrow="Incident" title="The VLAN 10 incident" tone="danger">
        <Callout tone="danger" title="The report" icon="!">
          {l2Ticket("prune").report}
        </Callout>
        <L2Result s={L2_INC} title="The lab: reproducing it" />
        <CliPanel run={l2Cli(L2_INC, "HOST-A", "ping -c 3 10.10.10.12")} caption="Linux · HOST-A — no ARP reply: Destination Host Unreachable" />
        <p>HOST-A can&apos;t even resolve HOST-B&apos;s MAC: its ARP broadcast never gets an answer. Yet management between SW1 and SW3 — VLAN 20, over the same trunks — works. Something stops VLAN 10 only.</p>
      </GuideSection>

      <GuideSection id="l2l-follow" eyebrow="Investigation" title="Follow the frame" tone="ip">
        <DiagramFrame caption="The guided lesson's drop at SW2.">
          <DropDiagram />
        </DiagramFrame>
        <p>Walk the ARP switch by switch. SW1 receives it untagged on <Mono>ge-0/0/1</Mono> (VLAN 10) and floods it tagged out of <Mono>ge-0/0/49</Mono> — its only forwarding trunk. SW2 receives it, learns HOST-A — and has nowhere to send it: <Mono>ge-0/0/51</Mono> doesn&apos;t carry VLAN 10.</p>
        <CliPanel run={l2Only(L2_INC, "SW2", "show ethernet-switching table", /Ethernet switching table|USERS/)} caption="Junos · SW2 — HOST-A learned on ge-0/0/49: the frame arrived" />
        <CliPanel run={l2Only(L2_INC, "SW3", "show ethernet-switching table vlan-name USERS", /Ethernet switching table|USERS/)} caption="Junos · SW3 — only HOST-B: the frame never arrived" />
      </GuideSection>

      <GuideSection id="l2l-tables" eyebrow="Investigation" title="What the tables say" tone="violet">
        <DiagramFrame caption="The guided lesson's VLAN 20 versus VLAN 10.">
          <OtherVlanDiagram />
        </DiagramFrame>
        <CliPanel run={l2Cli(L2_INC, "SW2", "show ethernet-switching interface ge-0/0/51")} caption="Junos · SW2 ge-0/0/51 — MGMT tagged, no USERS" />
        <CliPanel run={l2Only(L2_INC, "SW1", "ping 10.20.20.3 count 4", /statistics|transmitted/)} caption="Junos · SW1 — VLAN 20 crosses the same trunk fine" />
        <CliPanel run={l2Only(L2_INC, "SW1", "show spanning-tree interface", /Interface|ge-0\/0\/49|ge-0\/0\/50/)} caption="Junos · SW1 — spanning tree unchanged" />
        <ChecklistCard tone="violet" title="Three independent witnesses" mark="→" items={["SW2 learned HOST-A, SW3 never did — the frame stops between them", "VLAN 20 crosses the same trunk — the link is fine", "SW2 ge-0/0/51's VLAN list has no USERS — the cause"]} />
        <DiagramFrame caption="The guided lesson's MAC tables after aging.">
          <AgingDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l2l-trunk" eyebrow="Investigation" title="The trunk, both ends" tone="warning">
        <DiagramFrame caption="The guided lesson's two trunk ends.">
          <BothEndsDiagram />
        </DiagramFrame>
        <CliPanel run={l2Only(L2_INC, "SW3", "show ethernet-switching interface ge-0/0/51", /ge-0\/0\/51|MGMT|USERS|default/)} caption="Junos · SW3 ge-0/0/51 — the far end still carries USERS" />
        <p className="text-sm text-pv-text-muted">A trunk works only if both ends carry the VLAN. SW3 would accept VLAN 10 — SW2 never sends it. Comparing both ends of every trunk on the path is the quickest way to find this class of fault.</p>
      </GuideSection>

      <GuideSection id="l2l-repair" eyebrow="Repair" title="Repair and proof" tone="success">
        <p>Add USERS back to SW2 <Mono>ge-0/0/51</Mono>. Nothing else changes: same links, same tree, same management.</p>
        <CliPanel run={{ prompt: "admin@SW2# ", command: "set interfaces ge-0/0/51 unit 0 family ethernet-switching vlan members USERS", output: "\n[edit]\nadmin@SW2# commit and-quit\ncommit complete\nExiting configuration mode" }} caption="Junos · SW2 — add the VLAN" />
        <L2Result s={L2_FIX} from={L2_INC.tests.length} title="The lab: a fresh ping" />
        <CliPanel run={l2Only(L2_FIX, "SW3", "show ethernet-switching table vlan-name USERS", /Ethernet switching table|USERS/)} caption="Junos · SW3 — HOST-A learned on ge-0/0/51: the frame crossed" />
        <DiagramFrame caption="The guided lesson's before and after.">
          <VerifyDiagram />
        </DiagramFrame>
        <ChecklistCard tone="success" title="Proved, not assumed" mark="✓" items={["SW2 ge-0/0/51 carries USERS tagged", "a fresh ping: 4/4", "SW3 learned HOST-A in USERS on ge-0/0/51", "spanning tree and VLAN 20 untouched"]} />
      </GuideSection>

      <GuideSection id="l2l-other" eyebrow="Beyond this incident" title="Other ways it breaks" tone="warning">
        <FailureSignatures
          items={[
            { tag: "ACC", title: "Wrong access VLAN", tone: "warning", points: ["host's MAC learned in another VLAN", "link and IP fine"] },
            { tag: "NAT", title: "Native mismatch", tone: "danger", points: ["MAC learned in VLAN default", "one VLAN leaks into another"] },
            { tag: "MODE", title: "Access vs trunk", tone: "danger", points: ["every VLAN dropped on that link", "input drops rise"] },
            { tag: "LOOP", title: "No spanning tree", tone: "danger", points: ["broadcast storm", "MACs flap between ports"] },
          ]}
        />
        <CliPanel run={l2Only(T.access, "SW3", "show ethernet-switching table", /MGMT\s+00:00:5e:00:53:0b|Ethernet switching table/)} caption="Junos · SW3 — HOST-B learned in MGMT: its port is in the wrong VLAN" />
        <CliPanel run={l2Only(T.native, "SW2", "show ethernet-switching table", /default|Ethernet switching table/)} caption="Junos · SW2 — HOST-A learned in VLAN default: natives disagree" />
        <CliPanel run={l2Only(T.loop, "SW2", "show log messages", /MAC_MOVE/)} caption="Junos · SW2 — a loop: HOST-A's MAC keeps moving between ports" />
        <p className="text-sm text-pv-text-muted">Each is a ticket in the Layer 2 Lab, together with this incident.</p>
      </GuideSection>

      <GuideSection id="l2l-model" eyebrow="Mental model" title="Mental model" tone="cyan">
        <p>
          Think of a building with several companies sharing the same corridors. Each employee badge has a company colour (the VLAN); the reception desks (access ports) give visitors the right colour without telling them; the service lifts between floors (trunks) carry only the colours on their list, each person wearing a coloured armband (the tag). Each desk keeps a notebook of who arrived from which corridor (the MAC table). And one corridor between three floors is roped off (the blocked port) so nobody walks in circles. When a visitor never arrives, you check the notebooks floor by floor — and the lift&apos;s list.
        </p>
        <Callout tone="cyan" title="When it breaks, ask in this order" icon="→">
          Which VLAN fails, which works? Are the links up? Does spanning tree block exactly one port? Where has each switch learned the hosts — in which VLAN, on which port? Does every port on the path carry the VLAN the same way at both ends?
        </Callout>
      </GuideSection>

      <GuideSection id="l2l-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "MAC table (FDB)", def: "VLAN + MAC → port entries learned from source addresses; aged out after 300 s." },
            { term: "Flooding", def: "Sending a broadcast or unknown-destination frame out of every forwarding port in its VLAN." },
            { term: "Access port", def: "A port in one VLAN; frames are untagged." },
            { term: "Trunk", def: "A port carrying several VLANs tagged (802.1Q) and one native VLAN untagged." },
            { term: "Native VLAN", def: "The VLAN a trunk sends and receives untagged; must match at both ends." },
            { term: "Root bridge", def: "The bridge with the lowest priority/ID; the root of the spanning tree." },
            { term: "Alternate port", def: "An RSTP port that discards to break a loop, ready to take over." },
            { term: "Broadcast storm", def: "Broadcasts circulating endlessly in a loop without spanning tree." },
          ]}
        />
      </GuideSection>

      <GuideSection id="l2l-recap" eyebrow="Reference" title="Recap" tone="success">
        <ChecklistCard tone="success" title="You can now" mark="✓" items={["read MAC tables", "tell access from trunk, tagged from untagged", "read spanning-tree roles", "follow a broadcast hop by hop", "recognise missing VLANs, native and mode mismatches, loops", "prove a repair with fresh traffic"]} />
      </GuideSection>

      <GuideSection id="l2l-practice" eyebrow="Next" title="Practice it" tone="violet">
        <p>The Deep Dive tab covers Layer 2 in full: learning and aging, flooding, the 802.1Q header, access and trunk ports, native VLANs, RSTP election, roles and states, loops and storms, aggregated links, and every failure signature with real evidence. The lab lets you break and repair it yourself.</p>
        <LessonLabBridge />
        <PresentationBridge>Rewatch the Layer 2 presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
