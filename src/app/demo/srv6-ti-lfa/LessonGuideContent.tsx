import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, FlowSteps, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DHeaderColumn, Srv6Topology, type Srv6Link, type Srv6Pos } from "@/components/lesson/Srv6GuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { buildRepairSid, endXFunctionFor } from "@/lib/sim-engine/scenarios/srv6TiLfa";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import { createT6Net, lossText, t6Apply, t6Ticket, t6TicketState, type T6Action, type T6Fail, type T6R, type T6Rtr, type T6State, type T6TicketId, type Naive } from "@/lib/sim-engine/scenarios/s6tNet";
import { t6Sets, t6StaticApi } from "./t6-lab/t6Cli";

export const SRV6T_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "rl-mission", label: "What this lesson teaches" },
  { id: "rl-network", label: "The network of this lesson" },
  { id: "rl-ideas", label: "Three ideas you need" },
  { id: "rl-watch", label: "What you will watch" },
  { id: "rl-naive", label: "Why a simple reroute loops" },
  { id: "rl-phases", label: "Precompute, then activate" },
  { id: "rl-pq", label: "Where the repair can go" },
  { id: "rl-repair", label: "The repair: an interface and a SID" },
  { id: "rl-usd", label: "End.X with USD at P4" },
  { id: "rl-walk", label: "The protected packet" },
  { id: "rl-node", label: "When the router fails" },
  { id: "rl-detect", label: "Detection: BFD on a silent link" },
  { id: "rl-reverse", label: "The other direction" },
  { id: "rl-working", label: "What working looks like" },
  { id: "rl-incident", label: "The looping-repair incident" },
  { id: "rl-repairproof", label: "Repair and proof" },
  { id: "rl-other", label: "Other ways it breaks" },
  { id: "rl-model", label: "Mental model" },
  { id: "rl-glossary", label: "Glossary" },
  { id: "rl-recap", label: "Recap" },
  { id: "rl-practice", label: "Practice it" },
];

/** Real IOS XR output and drill results on this page come from the SRv6 TI-LFA Lab. */
const NL = String.fromCharCode(10);
const T0: T6State = createT6Net(0);
const run = (s: T6State, ...a: T6Action[]) => a.reduce((acc, x) => t6Apply(acc, x), s);
export const t6Set = (text: string, dev: T6R, f: (c: T6Rtr) => void): T6Action => ({ type: "set", text, changes: [{ dev, f }] });
export const t6Drill = (fail: T6Fail, naive?: Naive): T6Action => ({ type: "drill", fail, naive });
export const t6TicketRun = (id: T6TicketId) => t6Ticket(id).repro.reduce((acc, a) => t6Apply(acc, a), t6TicketState(id, 1));
const CUT = t6Drill({ link: "P1-P2" });
const LINKONLY = run(T0, t6Set("link-only", "P1", (c) => void (c.ifs["ge-0/0/1"]!.node = false)));
const L_CUT = run(LINKONLY, CUT);
const H_CUT = run(T0, CUT);
const H_NODE = run(T0, t6Drill({ node: "P2" }));
const NAIVE = run(T0, t6Drill({ link: "P1-P2" }, "plain"));
const P2END = run(T0, t6Drill({ link: "P1-P2" }, "p2end"));
const NOBFD = run(T0, t6Set("no bfd", "P1", (c) => void (c.ifs["ge-0/0/1"]!.bfd = false)), CUT);
const INC = t6TicketRun("p4srv6");
const INC_FIX = run(INC, t6Set("fix", "P4", (c) => void (c.isisLoc = true)), CUT);
export function t6Cli(s: T6State, r: T6R, command: string) {
  return runGuideCli(t6Sets(t6StaticApi(s, r), r).cisco, command);
}
export function t6Only(s: T6State, r: T6R, command: string, match: RegExp, keep = 0) {
  const x = t6Cli(s, r, command);
  return { ...x, output: pickLines(x.output, match, keep) };
}
/** Lines from the first match of `from` up to (not including) the first later match of `stop`. */
export function t6Block(s: T6State, r: T6R, command: string, from: RegExp, stop?: RegExp) {
  const x = t6Cli(s, r, command);
  const lines = x.output.split(NL);
  const i = lines.findIndex((l) => from.test(l));
  if (i < 0) return x;
  let j = stop ? lines.findIndex((l, k) => k > i && stop.test(l)) : -1;
  if (j < 0) j = lines.length;
  return { ...x, output: lines.slice(i, j).join(NL) };
}
/** One flow of the state's last drill, as the lab reports it. */
export function T6Result({ s, title, flow = "CE1 → CE2" }: { s: T6State; title: string; flow?: string }) {
  const d = s.drills[s.drills.length - 1];
  const r = d.results.find((x) => x.flow === flow)!;
  const good = r.affected && r.how === "local" && r.lossMs < 1000;
  return (
    <Callout tone={!r.affected || good ? "success" : "danger"} title={title} icon={!r.affected || good ? "✓" : "!"}>
      {d.what}: {r.flow} {r.affected ? `— PLR ${r.plr}, ${r.how === "local" ? "repaired locally" : r.how === "loop" ? "loops" : r.how === "converge" ? "waits for convergence" : "lost"}, traffic lost ${lossText(r.lossMs)}${r.backup?.repair.length ? `, repair [${r.backup.repair.join(", ")}]` : ""}. ${r.why}.` : "is not affected."}
    </Callout>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the SRv6 TI-LFA Lab" onPractice={openLab}>
      The network of this lesson on IOS XR: every router&apos;s backups and SIDs, drills of any link or router failure, hand-built repairs to compare, an IOS XR console — your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const POS: Srv6Pos = {
  PE1: [55, 100],
  P1: [185, 100],
  P2: [420, 40],
  PE2: [585, 100],
  P3: [285, 190],
  P4: [455, 190],
};
const LINKS: Srv6Link[] = [
  { a: "PE1", b: "P1", label: "10" },
  { a: "P1", b: "P2", label: "10" },
  { a: "P2", b: "PE2", label: "10" },
  { a: "P1", b: "P3", label: "10" },
  { a: "P3", b: "P4", label: "10" },
  { a: "P4", b: "P2", label: "50" },
  { a: "P4", b: "PE2", label: "70" },
];

function TopologyDiagram() {
  const primary = new Set(["PE1-P1", "P1-P2", "P2-PE2"]);
  return (
    <DiagramSvg h={240} label="Primary path PE1 P1 P2 PE2 with metric 10 per link; protection topology P1 P3 P4 with P4-P2 metric 50 and P4-PE2 metric 70; P1 is the PLR and P1-P2 the protected link">
      <Srv6Topology
        pos={POS}
        links={LINKS.map((l) => (primary.has(`${l.a}-${l.b}`) ? { ...l, color: D.cyan, bold: true, label: `${l.a}-${l.b}` === "P1-P2" ? "10 · protected" : l.label } : { ...l, dashed: true }))}
        sub={{ PE1: "headend", P1: "PLR", P2: "", PE2: "destination" }}
        accent={{ P1: D.warning, PE2: D.success }}
      />
      <text x={320} y={232} textAnchor="middle" fill={D.muted} fontSize={10}>
        solid = primary path (cost 30) · dashed = protection topology · numbers = IGP metrics
      </text>
    </DiagramSvg>
  );
}

function NaiveLoopDiagram() {
  return (
    <DiagramSvg h={150} label="After P1-P2 fails, P1 sends the original packet with DA PE2 to P3; P3 has not converged and its FIB still points to P1, so the packet loops">
      <DNode x={150} y={70} label="P1" sub="knows the failure" accent={D.warning} w={140} />
      <DNode x={470} y={70} label="P3" sub="STALE FIB: PE2 via P1" accent={D.danger} w={170} />
      <DArrow x1={222} y1={56} x2={383} y2={56} color={D.ip} label="DA = PE2 (original)" />
      <DArrow x1={383} y1={86} x2={222} y2={86} color={D.danger} label="back to P1" labelDy={16} />
      <text x={320} y={138} textAnchor="middle" fill={D.muted} fontSize={10}>
        the outgoing interface was fine — the original destination is what P3 misroutes
      </text>
    </DiagramSvg>
  );
}

function PqDiagram() {
  const box = (x: number, w: number, title: string, members: string, sub: string, color: string) => (
    <g>
      <rect x={x} y={26} width={w} height={96} rx={12} fill={color} fillOpacity={0.08} stroke={color} strokeOpacity={0.7} strokeDasharray="6 5" />
      <text x={x + 14} y={48} fill={color} fontSize={11.5} fontWeight={700}>
        {title}
      </text>
      <text x={x + 14} y={76} fill={D.text} fontSize={13} fontWeight={700} fontFamily="monospace">
        {members}
      </text>
      <text x={x + 14} y={104} fill={D.muted} fontSize={9.5}>
        {sub}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={170} label="P-Space of P1 is PE1, P3, P4; Extended P-Space adds nothing here; Q-Space of PE2 is only P2; they do not intersect, so the repair forces the P4 to P2 adjacency">
      {box(20, 190, "P-Space(P1)", "PE1 · P3 · P4", "P1's current paths avoid P1-P2", D.cyan)}
      {box(225, 190, "Extended P-Space", "same set here", "via P1's eligible neighbors", D.violet)}
      {box(430, 190, "Q-Space(PE2)", "P2", "current path to PE2 avoids P1-P2", D.success)}
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        no node is in both — so the repair ends with a forced adjacency from the last P-Space node (P4) into Q-Space (P2)
      </text>
    </DiagramSvg>
  );
}

function RepairAnatomyDiagram() {
  return (
    <DiagramSvg h={150} label="The repair has two parts: the outgoing interface P1 to P3, and the repair program: one SID, P4 End.X plus USD toward P2">
      <DNode x={130} y={60} label="Outgoing interface" sub="P1 → P3" accent={D.cyan} w={190} />
      <text x={320} y={66} textAnchor="middle" fill={D.text} fontSize={18} fontWeight={700}>
        +
      </text>
      <DNode x={510} y={60} label="Repair program" sub="<P4 End.X+USD → P2>" accent={D.violet} w={220} />
      <text x={320} y={126} textAnchor="middle" fill={D.muted} fontSize={10}>
        both precomputed and installed before any failure; the failure only activates them
      </text>
    </DiagramSvg>
  );
}

/** P4's two End.X+USD instances — values read from the lesson's own SID allocation, never retyped. */
const LINK_SID = buildRepairSid("P4", "P2");
const NODE_SID = buildRepairSid("P4", "PE2");
const fnHex = (owner: "P4", adj: "P2" | "PE2") => `0x${endXFunctionFor(owner, adj).toString(16)}`;

function LinkVsNodeSidDiagram() {
  const row = (y: number, sid: string, fn: string, adj: string, lab: string, color: string) => (
    <g>
      <rect x={150} y={y} width={470} height={34} rx={8} fill={color} fillOpacity={0.1} stroke={color} strokeOpacity={0.75} />
      <text x={164} y={y + 21} fill={D.text} fontSize={11.5} fontWeight={700} fontFamily="monospace">
        {sid}
      </text>
      <text x={400} y={y + 21} fill={color} fontSize={10.5} fontWeight={700} fontFamily="monospace">
        End.X+USD → {adj}
      </text>
      <text x={606} y={y + 21} textAnchor="end" fill={D.muted} fontSize={9.5} fontFamily="monospace">
        fn {fn}
      </text>
      <text x={140} y={y + 21} textAnchor="end" fill={D.muted} fontSize={9.5}>
        {lab}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={170} label={`P4's Local SID Table holds two End.X plus USD SIDs: ${LINK_SID.sidText} bound to adjacency P2 for link protection, and ${NODE_SID.sidText} bound to adjacency PE2 for node protection`}>
      <DNode x={70} y={26} label="P4" sub="Local SID Table" accent={D.violet} w={110} />
      {row(56, LINK_SID.sidText, fnHex("P4", "P2"), "P2", "link lab", D.cyan)}
      {row(98, NODE_SID.sidText, fnHex("P4", "PE2"), "PE2", "node lab", D.warning)}
      <text x={320} y={156} textAnchor="middle" fill={D.muted} fontSize={10}>
        one End.X SID = one local instance bound to ONE adjacency · two adjacencies need two SIDs
      </text>
    </DiagramSvg>
  );
}

function LayersDiagram() {
  return (
    <DiagramSvg h={200} label="Leaving P1: repair outer IPv6 with source P1 and destination P4 End.X plus USD, no SRH, wrapping the original PE1 to PE2 packet. After P4: only the original packet, forced toward P2">
      <text x={188} y={20} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
        leaving P1 (toward P3)
      </text>
      <DHeaderColumn
        x={188}
        y={32}
        w={250}
        rows={[
          { text: "repair outer · SA = P1", color: D.warning, tag: "REPAIR", strong: true },
          { text: "DA = P4 End.X+USD", color: D.warning },
          { text: "no SRH (single SID)", color: D.faint },
          { text: "IPv6 · PE1 → PE2 (untouched)", color: D.ip, tag: "ORIGINAL" },
        ]}
      />
      <DArrow x1={318} y1={72} x2={388} y2={72} color={D.faint} label="USD at P4" />
      <text x={505} y={20} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
        leaving P4 (forced to P2)
      </text>
      <DHeaderColumn x={505} y={32} w={210} rows={[{ text: "IPv6 · PE1 → PE2 (untouched)", color: D.ip, tag: "ORIGINAL" }]} />
      <text x={320} y={180} textAnchor="middle" fill={D.muted} fontSize={10}>
        USD removes the ENTIRE repair outer (and any extension headers) — never just an SRH
      </text>
    </DiagramSvg>
  );
}

function NestedDiagram() {
  return (
    <DiagramSvg h={200} label="Nested protection: repair outer from P1 to P4 End.X plus USD wraps the SRv6 L3VPN outer from PE1 to PE2 End.DT4, which wraps customer IPv4; P4 removes only the repair outer">
      <DHeaderColumn
        x={200}
        y={24}
        w={270}
        rows={[
          { text: "repair outer · SA P1 → DA P4 End.X+USD", color: D.warning, tag: "TI-LFA", strong: true },
          { text: "L3VPN outer · SA PE1 → DA PE2 End.DT4", color: D.bgp, tag: "SERVICE" },
          { text: "customer IPv4 10.10.1.10 → 10.20.1.10", color: D.ip, tag: "CUSTOMER" },
        ]}
      />
      <DArrow x1={345} y1={60} x2={400} y2={60} color={D.faint} label="P4" />
      <DHeaderColumn
        x={520}
        y={24}
        w={210}
        rows={[
          { text: "L3VPN outer (intact)", color: D.bgp, strong: true },
          { text: "customer IPv4", color: D.ip },
        ]}
      />
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        P4 does not execute End.DT4 — PE2 does, exactly as if no failure had happened
      </text>
    </DiagramSvg>
  );
}


export function Srv6TiLfaLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="rl-mission" eyebrow="This lesson" title="What this lesson teaches" tone="danger">
        <p>
          The previous lesson built CUST-A&apos;s VPN over SRv6. This one keeps it alive when the network breaks. IS-IS will always repair forwarding eventually — but convergence takes hundreds of milliseconds, and every one of them is lost customer traffic. <b className="text-pv-text">TI-LFA</b> (RFC 9855) closes that gap: the router in front of the failure switches to a precomputed repair within milliseconds of detecting it, before anyone else knows.
        </p>
        <p>You will see why the obvious reroute loops, how TI-LFA turns the post-convergence path into SRv6 SIDs that stale routers obey, what End.X with USD does at the repair node, how node protection and BFD change the outcome — and the guided lesson&apos;s incident: a repair that looks right and loops.</p>
        <ChecklistCard tone="violet" title="By the end of this lesson you can" mark="→" items={["name the PLR for a failure and a flow", "explain why stale tables make a simple reroute loop", "read a TI-LFA backup: outgoing interface plus repair SIDs", "explain End.X with USD at the repair node", "tell link from node protection and why detection matters", "find, fix and prove a protection fault with a drill"]} />
      </GuideSection>

      <GuideSection id="rl-network" eyebrow="This lesson" title="The network of this lesson" tone="ospf">
        <DiagramFrame caption="PLR = P1 · protected resource = link P1–P2 · destination = PE2.">
          <TopologyDiagram />
        </DiagramFrame>
        <p>
          CUST-A&apos;s traffic from CE1 to CE2 runs PE1 → P1 → P2 → PE2 (metric 10 per link, cost 30), encapsulated by PE1 to PE2&apos;s End.DT4. The protection side — P1–P3–P4 (10 + 10), P4–P2 (50), P4–PE2 (70) — carries nothing until something fails. P1–P2 runs over a DWDM system: a failure in the optical span doesn&apos;t take the interfaces down.
        </p>
        <Callout tone="cyan" title="The lesson and the lab" icon="i">
          The guided lesson numbers P4&apos;s End.X SIDs by hand — toward P2 <Mono>2001:db8:110:14:2::</Mono>, toward PE2 <Mono>…:14:22::</Mono> — and walks one failure step by step. The lab runs IOS XR, which allocates End.X dynamically per interface: toward P3 <Mono>…:14:40::</Mono>, toward P2 <Mono>…:14:41::</Mono>, toward PE2 <Mono>…:14:42::</Mono>. It computes every backup on every router, lets you drill any link or router failure, and protects with node protection by default. Outputs below come from the lab.
        </Callout>
      </GuideSection>

      <GuideSection id="rl-ideas" eyebrow="This lesson" title="Three ideas you need" tone="violet">
        <CompareCards
          items={[
            { title: "Local repair", tone: "danger", tag: "the PLR", points: ["the router in front of the failure", "switches before anyone converges"] },
            { title: "Stale tables", tone: "warning", tag: "the trap", points: ["everyone else still uses old routes", "a repair must force its way past them"] },
            { title: "TI-LFA", tone: "cyan", tag: "the method", points: ["the post-convergence path", "written as an interface + SRv6 SIDs"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="rl-watch" eyebrow="This lesson" title="What you will watch" tone="cyan">
        <TroubleshootingFlow
          steps={[
            { question: "P1 precomputes a backup for PE2", look: "out to P3, repair SID P4's End.X" },
            { question: "P1–P2 fails; P1 detects it", look: "BFD on the silent link: 150 ms" },
            { question: "P1 encapsulates and sends to P3", look: "outer DA = P4's End.X, the VPN packet inside" },
            { question: "P3 routes on P4's locator", look: "its old table is fine for that" },
            { question: "P4 executes End.X with USD", look: "strips the repair, sends out the forced link" },
            { question: "The VPN packet reaches PE2 and CE2", look: "~165 ms of loss, not ~1 s" },
          ]}
        />
      </GuideSection>

      <GuideSection id="rl-naive" eyebrow="Motivation" title="Why a simple reroute loops" tone="danger">
        <DiagramFrame caption="The guided lesson builds it from real per-router tables.">
          <NaiveLoopDiagram />
        </DiagramFrame>
        <p>
          Suppose P1 just sent PE2&apos;s traffic to P3. P3 has not heard about the failure; its route to PE2 is still via P1 (30, versus 90 via P4). The packet bounces P1 ↔ P3 until P3 converges. Any repair has to work with routers whose tables are still <b className="text-pv-text">stale</b>.
        </p>
        <T6Result s={NAIVE} title="The lab: a plain reroute through P3" />
      </GuideSection>

      <GuideSection id="rl-phases" eyebrow="Timing" title="Precompute, then activate" tone="cyan">
        <FlowSteps
          steps={[
            { title: "Steady state", body: "Primary path in use; the backup is already computed and installed in the forwarding table.", tone: "success" },
            { title: "Failure detected at the PLR", body: "P1 notices its own link is gone — by loss of light or BFD. No flooding needed.", tone: "danger" },
            { title: "Repair active", body: "P1 sends protected traffic through the backup. No computation at failure time.", tone: "warning" },
            { title: "Convergence, then release", body: "IS-IS converges; P1's new primary path takes over and the repair is no longer used.", tone: "ospf" },
          ]}
        />
      </GuideSection>

      <GuideSection id="rl-pq" eyebrow="Computation" title="Where the repair can go" tone="warning">
        <DiagramFrame caption="P-space and Q-space with P1–P2 as the protected link.">
          <PqDiagram />
        </DiagramFrame>
        <p>
          TI-LFA starts from the path traffic will take once everyone has converged without P1–P2: <Mono>P1 → P3 → P4 → P2 → PE2</Mono>. The <b className="text-pv-text">P-space</b> holds routers P1 reaches without the link (P3, P4); the <b className="text-pv-text">Q-space</b> holds routers whose own path to PE2 avoids it (P2). P4 is in P1&apos;s safe space, but P4&apos;s own old path toward P2 goes back via P3 and P1 — so P4 must be told which link to use.
        </p>
      </GuideSection>

      <GuideSection id="rl-repair" eyebrow="Repair" title="The repair: an interface and a SID" tone="violet">
        <DiagramFrame caption="A TI-LFA repair is an outgoing interface plus a repair program.">
          <RepairAnatomyDiagram />
        </DiagramFrame>
        <p>
          The backup is <b className="text-pv-text">out of P1&apos;s link to P3</b>, with a new outer header whose destination is P4&apos;s End.X toward P2. That one SID is enough: it is routed under P4&apos;s locator (so it gets P3 → P4 on old tables) and executed at P4 (so it forces P4 → P2). One SID fits in the destination address — no SRH.
        </p>
        <CliPanel run={t6Only(LINKONLY, "P1", "show isis fast-reroute 2001:db8:110:2::/64 detail", /^L2|via fe80|Backup path|node:|Backup-src/)} caption="IOS XR · P1 with link protection — backup via P3, repair SID P4 End.X → P2" />
      </GuideSection>

      <GuideSection id="rl-usd" eyebrow="Endpoint behavior" title="End.X with USD at P4" tone="violet">
        <CompareCards
          items={[
            { title: "End.X", tone: "violet", tag: "base behavior", points: ["local SID match at P4", "forces the P4 → P2 adjacency", "never rewrites the exposed packet"] },
            { title: "USD flavor", tone: "warning", tag: "Ultimate Segment Decapsulation", points: ["at the last segment, remove the repair's outer IPv6 header", "expose the packet underneath", "send it out of the forced link"] },
          ]}
        />
        <CliPanel run={t6Cli(T0, "P4", "show segment-routing srv6 sid")} caption="IOS XR · P4 — one End.X (PSP/USD) per adjacency" />
      </GuideSection>

      <GuideSection id="rl-walk" eyebrow="Data plane" title="The protected packet" tone="ip">
        <DiagramFrame caption="P3 forwards on P4's locator with its ordinary table — no TI-LFA knowledge needed.">
          <LayersDiagram />
        </DiagramFrame>
        <DiagramFrame caption="The guided lesson's nested packet: the repair outside, the VPN packet inside.">
          <NestedDiagram />
        </DiagramFrame>
        <p>
          On P1 → P3 → P4 the packet carries two IPv6 headers: the repair (DA = P4&apos;s End.X) outside, CUST-A&apos;s VPN packet (DA = PE2&apos;s End.DT4) inside. P4 strips the outer one and sends the VPN packet to P2, which forwards it to PE2 on its normal route. PE2 executes its End.DT4 and CE2 gets an ordinary IPv4 packet — it never knew.
        </p>
        <T6Result s={L_CUT} title="The lab: P1–P2 cut, link protection" />
        <p className="text-sm text-pv-text-muted">150 ms of BFD detection plus 15 ms to switch — instead of 150 ms plus ~800 ms of convergence.</p>
      </GuideSection>

      <GuideSection id="rl-node" eyebrow="Protection scope" title="When the router fails" tone="danger">
        <DiagramFrame caption="Link protection merges at P2; node protection bypasses it.">
          <LinkVsNodeSidDiagram />
        </DiagramFrame>
        <p>
          A link-protecting repair merges back at P2. If P2 itself fails, that repair delivers into a dead router. <b className="text-pv-text">Node protection</b> computes the path that avoids P2 — P1 → P3 → P4 → PE2 — and the repair becomes P4&apos;s End.X toward PE2. On IOS XR: <Mono>fast-reroute per-prefix tiebreaker node-protecting index 100</Mono>. The lab runs it by default, so P1&apos;s backup covers both cases.
        </p>
        <CliPanel run={t6Only(T0, "P1", "show isis fast-reroute 2001:db8:110:2::/64 detail", /Backup path|node:|NP:/)} caption="IOS XR · P1 — node-protecting backup: P4 End.X → PE2" />
        <T6Result s={H_NODE} title="The lab: P2 fails" />
      </GuideSection>

      <GuideSection id="rl-detect" eyebrow="Detection" title="Detection: BFD on a silent link" tone="warning">
        <p>
          The repair is ready in the forwarding table, but P1 must first notice the failure. A fiber cut on a plain link is detected by loss of light in ~10 ms. P1–P2 runs over DWDM: when the optical span fails the interfaces stay up. <b className="text-pv-text">BFD</b> (50 ms × 3) notices in 150 ms; without it P1 waits for the IS-IS hold time — 30 s — before using its perfectly good backup.
        </p>
        <CliPanel run={t6Cli(T0, "P1", "show bfd session")} caption="IOS XR · P1 — BFD on the DWDM link" />
        <T6Result s={NOBFD} title="The lab: the same cut without BFD on P1" />
      </GuideSection>

      <GuideSection id="rl-reverse" eyebrow="Protection scope" title="The other direction" tone="cyan">
        <p>CE2&apos;s replies cross P2 → P1. Their PLR is P2, with its own backup: out to P4, no repair SID at all — P4&apos;s own path to PE1 already avoids the link. Protection is per router and per direction; a network is only protected if every PLR on every path is.</p>
        <T6Result s={H_CUT} flow="CE2 → CE1" title="The lab: the replies during the P1–P2 cut" />
      </GuideSection>

      <GuideSection id="rl-working" eyebrow="Evidence" title="What working looks like" tone="success">
        <FieldTable
          title="Healthy, in five questions (IOS XR)"
          accent="success"
          columns={["Question", "Command", "Healthy answer"]}
          rows={[
            ["Does the PLR have a backup?", <Mono key="1">show isis fast-reroute 2001:db8:110:2::/64 detail</Mono>, "TI-LFA (node) via P3, P4 End.X → PE2"],
            ["Is it installed?", <Mono key="2">show cef ipv6 2001:db8:110:2::</Mono>, "backup (TI-LFA), SID-list {…:14:42::}"],
            ["Is FRR on the interface?", <Mono key="3">show isis interface Gi0/0/0/1</Mono>, "TI LFA Enabled, node-protecting"],
            ["Is BFD up on silent links?", <Mono key="4">show bfd session</Mono>, "UP, 150ms(50ms*3)"],
            ["What does a failure cost?", "a drill", "~165 ms (cut), ~25 ms (P2 fails), both directions"],
          ]}
        />
      </GuideSection>

      <GuideSection id="rl-incident" eyebrow="Incident" title="The looping-repair incident" tone="danger">
        <p>
          In the guided lesson P1&apos;s repair for P1–P2 is installed as P2&apos;s End SID. Detection works, the backup activates, P1 sends to P3 — and the traffic never arrives. P3 routes P2&apos;s locator with its stale table: back to P1. The repair names the right destination, but it doesn&apos;t force the path past a stale router.
        </p>
        <T6Result s={P2END} title="The lab: the same hand-built repair to P2's End" />
        <p>
          IOS XR computes its repairs itself, so the lab&apos;s ticket is the real-world cousin: after an upgrade P4 lost <Mono>segment-routing srv6 locator MAIN</Mono>. Without P4&apos;s End.X there is no SID that can force P4&apos;s link, so P1 installs no backup at all — TI-LFA configured, no protection.
        </p>
        <T6Result s={INC} title="The lab: P1–P2 cut with P4 lacking SRv6 (the ticket)" />
        <TroubleshootingFlow
          steps={[
            { question: "What did the cut cost?", look: "~950 ms — convergence, not local repair." },
            { question: "Does P1 have a backup?", look: "No — “the repair needs an SRv6 SID that P4 doesn't have”." },
            { question: "Is TI-LFA configured on P1?", look: "Yes — so the problem is downstream." },
            { question: "What does P4 have?", look: "No local SIDs: its locator isn't in IS-IS." },
          ]}
        />
        <CliPanel run={t6Only(INC, "P1", "show isis fast-reroute 2001:db8:110:2::/64 detail", /^L2|via fe80|No FRR|SRv6 SID that/)} caption="IOS XR · P1 — no backup, and why" />
        <CliPanel run={t6Cli(INC, "P4", "show isis segment-routing srv6 locators")} caption="IOS XR · P4 — no locator advertised" />
      </GuideSection>

      <GuideSection id="rl-repairproof" eyebrow="Incident" title="Repair and proof" tone="success">
        <CliPanel run={{ prompt: "RP/0/RP0/CPU0:P4(config)#", command: "router isis CORE address-family ipv6 unicast segment-routing srv6", output: "RP/0/RP0/CPU0:P4(config-isis-srv6)#locator MAIN\nRP/0/RP0/CPU0:P4(config-isis-srv6)#commit" }} caption="IOS XR · P4 — the repair" />
        <CliPanel run={t6Only(INC_FIX, "P1", "show isis fast-reroute 2001:db8:110:2::/64 detail", /Backup path|node:/)} caption="IOS XR · P1 — the backup is back" />
        <T6Result s={INC_FIX} title="The lab: a fresh drill of the cut" />
        <ChecklistCard tone="success" title="Proved, not assumed" mark="✓" items={["P4 has its End.X SIDs again", "P1's backup for PE2 is installed: P4 End.X → PE2", "a fresh drill repairs CE1 → CE2 locally in ~165 ms", "the lesson: a repair has to force its path, and every router it names needs the SID"]} />
      </GuideSection>

      <GuideSection id="rl-other" eyebrow="Beyond this incident" title="Other ways it breaks" tone="warning">
        <FailureSignatures
          items={[
            { tag: "LFA", title: "TI-LFA off on the PLR", tone: "danger", points: ["per-prefix only, no LFA exists here", "the cut waits for convergence"] },
            { tag: "NODE", title: "Link protection only", tone: "warning", points: ["a cut is fine", "a P2 failure isn't"] },
            { tag: "BFD", title: "No BFD on the DWDM link", tone: "danger", points: ["backup present", "used after 30 s"] },
            { tag: "DIR", title: "Other direction unprotected", tone: "violet", points: ["one flow ~165 ms", "the replies ~950 ms"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Each is a ticket in the SRv6 TI-LFA Lab, together with this incident.</p>
      </GuideSection>

      <GuideSection id="rl-model" eyebrow="Mental model" title="Mental model" tone="cyan">
        <p>
          Think of a road closure announced only to the driver who reaches it. Every other driver still follows yesterday&apos;s map. If the first driver simply turns into the next side street, the drivers there — following yesterday&apos;s map — send them straight back toward the closure. TI-LFA hands the driver a sealed instruction prepared in advance: “drive to P4&apos;s depot, and from there take the P4–P2 road” — destinations that yesterday&apos;s map still gets right, and one road the depot is told to take, whatever its map says. The instruction is only useful if the driver hears about the closure quickly, and every junction has its own.
        </p>
        <Callout tone="cyan" title="When it breaks, ask in this order" icon="→">
          What did the drill cost, per direction? Who is the PLR, and how did it detect the failure? What does its interface ask for? Does it have a backup — and if not, why? Do the routers the repair names have SRv6 SIDs?
        </Callout>
      </GuideSection>

      <GuideSection id="rl-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "PLR", def: "Point of local repair: the router in front of the failure that switches to the backup." },
            { term: "Post-convergence path", def: "The path traffic will take once every router has converged." },
            { term: "P-space / Q-space", def: "Routers the PLR / the destination reach without the failed resource." },
            { term: "TI-LFA", def: "Repair along the post-convergence path, written as an interface plus SIDs." },
            { term: "USD", def: "Ultimate Segment Decapsulation: the last repair SID strips the repair header." },
            { term: "Node protection", def: "A backup that avoids the next-hop router, not just the link." },
            { term: "BFD", def: "Fast failure detection by exchanging hellos every few milliseconds." },
          ]}
        />
      </GuideSection>

      <GuideSection id="rl-recap" eyebrow="Reference" title="Recap" tone="success">
        <ChecklistCard tone="success" title="You can now" mark="✓" items={["name the PLR and explain local repair", "explain why stale tables loop a simple reroute", "read a TI-LFA backup and its repair SIDs", "explain End.X with USD", "use node protection and BFD deliberately", "prove protection with a drill"]} />
      </GuideSection>

      <GuideSection id="rl-practice" eyebrow="Next" title="Practice it" tone="violet">
        <p>The Deep Dive tab covers TI-LFA on SRv6 in full: LFA, remote LFA and TI-LFA, P/Q-spaces, repair shapes, End vs End.X, flavors, timing and micro-loops, protection scope, nested services, IOS XR configuration and verification, and every failure signature with real evidence. The lab lets you drill it.</p>
        <LessonLabBridge />
        <PresentationBridge>Rewatch the SRv6 TI-LFA presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
