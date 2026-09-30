import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { LadderDiagram, WorkflowDiagram } from "@/components/lesson/TroubleshootingGuideSvg";
import { hex4 } from "@/lib/sim-engine/scenarios/fundamentalsPackets";
import { L2_IP, L2_PORTS, MGMT_VLAN, USER_VLAN, stpState, tci } from "@/lib/sim-engine/scenarios/troubleshootingLayer2";

export const L2_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "l2l-mission", label: "The mission" },
  { id: "l2l-method", label: "The method" },
  { id: "l2l-topology", label: "Topology & RSTP" },
  { id: "l2l-access-trunk", label: "Access vs trunk" },
  { id: "l2l-tag", label: "The 802.1Q tag" },
  { id: "l2l-mac", label: "Baseline MAC tables" },
  { id: "l2l-pipeline", label: "Bridging pipeline" },
  { id: "l2l-drop", label: "The drop at SW2" },
  { id: "l2l-other-vlan", label: "VLAN 20 still works" },
  { id: "l2l-aging", label: "Asymmetric MAC tables" },
  { id: "l2l-both-ends", label: "Both ends of the trunk" },
  { id: "l2l-ladder", label: "Evidence ladder" },
  { id: "l2l-verify", label: "Repair & verify" },
  { id: "l2l-glossary", label: "Glossary" },
];

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

export function L2LessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="l2l-mission" eyebrow="Mission" title="Follow one VLAN through the switches" tone="cyan">
        <p>Layer 2 faults hide well: every link can be up, spanning tree can be perfect, and one VLAN still stops dead at one port. This lesson teaches you to follow a VLAN hop by hop and to read each switch&apos;s own reason for forwarding or dropping a frame.</p>
      </GuideSection>

      <GuideSection id="l2l-method" eyebrow="Method" title="The same workflow, at Layer 2" tone="violet">
        <DiagramFrame caption="Scope by host, VLAN and path before touching anything.">
          <DiagramSvg h={82} label="Troubleshooting workflow">
            <WorkflowDiagram notes={["which hosts?", "VLAN + path", "pipelines, FDB", "one cause", "2nd VLAN", "one change", "same tests"]} />
          </DiagramSvg>
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l2l-topology" eyebrow="Topology" title="A redundant triangle, a loop-free tree" tone="cyan">
        <DiagramFrame caption="The SW2 ↔ SW3 trunk is on the active path.">
          <TopologyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l2l-access-trunk" eyebrow="VLANs" title="Access ports and trunks" tone="ethernet">
        <DiagramFrame caption="Tagged on trunks, untagged at the edges.">
          <AccessTrunkDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l2l-tag" eyebrow="802.1Q" title="The tag" tone="violet">
        <DiagramFrame caption="The VLAN ID is the low 12 bits of the TCI.">
          <TagDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l2l-mac" eyebrow="Baseline" title="Healthy MAC tables" tone="success">
        <DiagramFrame caption="Record the symmetric picture while things work.">
          <MacBaseline />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l2l-pipeline" eyebrow="Bridging" title="What a switch does with each frame" tone="cyan">
        <DiagramFrame caption="Every step has its own reason to forward or drop.">
          <PipelineDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l2l-drop" eyebrow="Incident" title="The drop at SW2" tone="danger">
        <DiagramFrame caption="The MAC was known — the VLAN was not permitted out.">
          <DropDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Read the switch's own reason">
          &quot;Destination unknown&quot; and &quot;VLAN not permitted&quot; are different failures. Here the lookup succeeded; the egress check removed the port.
        </Callout>
      </GuideSection>

      <GuideSection id="l2l-other-vlan" eyebrow="Test" title="Another VLAN on the same trunk" tone="success">
        <DiagramFrame caption="The cheapest test that rules out the link and STP.">
          <OtherVlanDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l2l-aging" eyebrow="MAC tables" title="Asymmetric learning" tone="warning">
        <DiagramFrame caption="What never arrives ages out — that locates the break.">
          <AgingDiagram />
        </DiagramFrame>
        <p>HOST-B is alive — SW3 still learns it locally. A missing MAC on a remote switch proves only that no frame from it has reached that switch recently.</p>
      </GuideSection>

      <GuideSection id="l2l-both-ends" eyebrow="Configuration" title="Check both ends of every trunk" tone="violet">
        <DiagramFrame caption="Allowed lists are configured independently on each side.">
          <BothEndsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l2l-ladder" eyebrow="Ladder" title="The lowest failing rung" tone="cyan">
        <DiagramFrame caption="Physical and STP healthy; VLAN membership failing.">
          <DiagramSvg h={130} label="Evidence ladder for this incident">
            <LadderDiagram
              rows={[
                { rung: "Physical / interface", evidence: "all ports up/up, no errors", status: "ok" },
                { rung: "Spanning tree", evidence: "roles/states = baseline", status: "ok" },
                { rung: "VLAN membership", evidence: "SW2 ge-0/0/51 allowed 20 only", status: "fail" },
                { rung: "MAC learning", evidence: "asymmetric for VLAN 10 (symptom)", status: "suspect" },
                { rung: "IP / ping", evidence: "0/5 (symptom)", status: "suspect" },
              ]}
            />
          </DiagramSvg>
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l2l-verify" eyebrow="Verify" title="One change, same tests" tone="success">
        <DiagramFrame caption="Spanning tree was never touched.">
          <VerifyDiagram />
        </DiagramFrame>
        <ChecklistCard tone="success" title="Verified" mark="✓" items={["SW2 ge-0/0/51 allows 10 and 20; VID 10 frames leave toward SW3", "MAC tables symmetric again on all three switches", "HOST-A → HOST-B 5/5", "RSTP roles and states unchanged; VLAN 20 undisturbed"]} />
      </GuideSection>

      <GuideSection id="l2l-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <Glossary
          items={[
            { term: "Access port", def: "Carries one VLAN, untagged (its PVID)." },
            { term: "Trunk", def: "Carries several VLANs, tagged with 802.1Q; only the allowed VLANs pass." },
            { term: "Native VLAN", def: "The VLAN sent untagged on a trunk; must match on both ends." },
            { term: "Ingress filtering", def: "Dropping a tagged frame whose VLAN is not allowed on the receiving port." },
            { term: "Unknown unicast", def: "A unicast frame whose destination MAC is not in the table; flooded within its VLAN." },
            { term: "Aging", def: "Removing a MAC entry after no frame from it has arrived for the aging time (300 s here)." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
