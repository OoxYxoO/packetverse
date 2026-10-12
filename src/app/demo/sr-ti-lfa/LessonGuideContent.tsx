import { Callout, ChecklistCard, CompareCards, DIAGRAM as D, DPill, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import { SrTopology, type SrLink } from "@/components/lesson/SrGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import { lossText, createTlNet, tlApply, tlIfs, TL_ROUTERS, type TlAction, type TlR, type TlRtr, type TlState } from "@/lib/sim-engine/scenarios/tlNet";
import { tlSets, tlStaticApi } from "./tl-lab/tlCli";

export const TILFA_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "tl-mission", label: "What this lesson teaches" },
  { id: "tl-network", label: "The network of this lesson" },
  { id: "tl-ideas", label: "Three ideas you need" },
  { id: "tl-cost", label: "The cost of waiting" },
  { id: "tl-plr", label: "The point of local repair" },
  { id: "tl-pq", label: "Post-convergence, P and Q" },
  { id: "tl-list", label: "The repair segment list" },
  { id: "tl-wire", label: "Local repair on the wire" },
  { id: "tl-ready", label: "Installed is not active" },
  { id: "tl-fail", label: "The failure, both directions" },
  { id: "tl-node", label: "Node protection" },
  { id: "tl-lfa", label: "Why not classic LFA" },
  { id: "tl-detect", label: "Detection is half the outage" },
  { id: "tl-limits", label: "When protection is unavailable" },
  { id: "tl-stale", label: "The stale-repair incident" },
  { id: "tl-working", label: "What working looks like" },
  { id: "tl-other", label: "Other ways it fails" },
  { id: "tl-model", label: "Mental model" },
  { id: "tl-glossary", label: "Glossary" },
  { id: "tl-recap", label: "Recap" },
  { id: "tl-practice", label: "Practice it" },
];

/** Real IOS XR / Junos output and drill results on this page come from the SR TI-LFA Lab — the guided lesson's network. */
const X0: TlState = createTlNet(0, "xr");
const J0: TlState = createTlNet(0, "junos");
const run = (s: TlState, ...a: TlAction[]) => a.reduce((acc, x) => tlApply(acc, x), s);
const set = (text: string, changes: { dev: TlR; f: (c: TlRtr) => void }[]): TlAction => ({ type: "set", text, changes });
const D24: TlAction = { type: "drill", fail: { link: "R2-R4" } };
const BARE = run(X0, set("no fast reroute", TL_ROUTERS.map((dev) => ({ dev, f: (c: TlRtr) => void tlIfs(dev).forEach((i) => Object.assign(c.ifs[i.ifn]!, { frr: false, lp: false, tilfa: false, node: false })) }))), D24);
const HEALTHY = run(X0, D24);
const NODE = run(X0, { type: "drill", fail: { node: "R4" } });
const LFA = run(X0, set("R4 classic LFA only", [{ dev: "R4", f: (c) => void Object.assign(c.ifs["ge-0/0/0"]!, { frr: true, lp: true, tilfa: false, node: false }) }]), D24);
const NOBFD = run(X0, set("no BFD on R2–R4", [{ dev: "R2", f: (c) => void (c.ifs["ge-0/0/1"]!.bfd = false) }, { dev: "R4", f: (c) => void (c.ifs["ge-0/0/0"]!.bfd = false) }]), D24);
const NOSR3 = run(X0, set("R3 without SR", [{ dev: "R3", f: (c) => void (c.sr = false) }]), D24);
const M25 = run(X0, set("R2–R3 metric 25", [{ dev: "R2", f: (c) => void (c.ifs["ge-0/0/2"]!.metric = 25) }, { dev: "R3", f: (c) => void (c.ifs["ge-0/0/0"]!.metric = 25) }]), D24);
export function tlCli(s: TlState, r: TlR, command: string) {
  return runGuideCli(tlSets(tlStaticApi(s, r), r)[s.os === "xr" ? "cisco" : "juniper"], command);
}
export function tlOnly(s: TlState, r: TlR, command: string, match: RegExp, keep = 0) {
  const x = tlCli(s, r, command);
  return { ...x, output: pickLines(x.output, match, keep) };
}
/** A block of an output: from the first line matching `start` up to the next line matching `stop`. */
export function tlBlock(s: TlState, r: TlR, command: string, start: RegExp, stop: RegExp, head = "") {
  const x = tlCli(s, r, command);
  const lines = x.output.split("\n");
  const i = lines.findIndex((l) => start.test(l));
  const j = lines.findIndex((l, k) => k > i && stop.test(l));
  return { ...x, output: [...(head ? [head] : []), ...lines.slice(i, j < 0 ? undefined : j)].join("\n") };
}
/** One drill, as the lab reports it. */
export function TlDrill({ s, title }: { s: TlState; title: string }) {
  const d = s.drills[s.drills.length - 1];
  const good = d.results.every((r) => !r.affected || (r.how === "local" && r.lossMs < 1000));
  return (
    <Callout tone={good ? "success" : "danger"} title={title} icon={good ? "✓" : "!"}>
      {d.results.map((r) => (
        <span key={r.flow} className="block">
          <b>{r.flow}</b>: {!r.affected ? "not affected" : `${r.how === "local" ? `repaired locally by ${r.plr}` : r.how === "lost" ? "lost until the failure is repaired" : `${r.plr} waited for convergence`}${r.how === "lost" ? "" : ` — ${lossText(r.lossMs)}`} (${r.why})`}
        </span>
      ))}
    </Callout>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the SR TI-LFA Lab" onPractice={openLab}>
      The network of this lesson on IOS XR or Junos: TI-LFA and BFD on every router, failure drills that measure the loss in both directions, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const LINKS: SrLink[] = [
  { a: "R1", b: "R2", label: "10" },
  { a: "R2", b: "R4", label: "10" },
  { a: "R4", b: "R6", label: "10" },
  { a: "R2", b: "R3", label: "15" },
  { a: "R3", b: "R5", label: "15" },
  { a: "R5", b: "R6", label: "15" },
];

function PrimaryDiagram() {
  const primary = new Set(["R1-R2", "R2-R4", "R4-R6"]);
  return (
    <DiagramSvg h={240} label="Primary path R1 R2 R4 R6 with metric 10 links; R2 is the local repair point for the protected R2-R4 link">
      <SrTopology
        links={LINKS.map((l) => {
          const id = `${l.a}-${l.b}`;
          if (id === "R2-R4") return { ...l, color: D.warning, bold: true, label: "10 · protected" };
          return primary.has(id) ? { ...l, color: D.success, bold: true } : l;
        })}
        sub={{ R1: "headend", R2: "PLR", R6: "destination" }}
        accent={{ R1: D.mpls, R2: D.warning, R6: D.mpls }}
      />
      <text x={320} y={228} textAnchor="middle" fill={D.muted} fontSize={10}>
        primary R1 → R2 → R4 → R6 (cost 30); R1 only connects to R2
      </text>
    </DiagramSvg>
  );
}

function PqDiagram() {
  return (
    <DiagramSvg h={240} label="For the R2-R4 link, P-space from R2 is R1 R3 R5, Q-space toward R6 is R3 R4 R5, and R5 is the selected PQ repair point">
      <SrTopology
        links={LINKS.map((l) => (`${l.a}-${l.b}` === "R2-R4" ? { ...l, color: D.danger, dashed: true, label: "protected" } : l))}
        sub={{ R1: "P", R2: "PLR", R3: "P ∩ Q", R4: "Q", R5: "P ∩ Q ✓", R6: "dest" }}
        accent={{ R1: D.cyan, R3: D.violet, R4: D.warning, R5: D.success }}
      />
      <text x={320} y={228} textAnchor="middle" fill={D.muted} fontSize={10}>
        P = {"{R1, R3, R5}"} · Q = {"{R3, R4, R5}"} · repair point = R5 (PQ closest to R6)
      </text>
    </DiagramSvg>
  );
}

function RepairWireDiagram() {
  const cols = [
    { x: 120, head: "R2 → R3", labels: [{ text: "16005 S0", color: D.warning, tag: "REPAIR" }, { text: "16006 S1", tag: "ORIGINAL" }], note: "R2 pushes the repair" },
    { x: 330, head: "R3 → R5", labels: [{ text: "16005 S0", color: D.warning }, { text: "16006 S1" }], note: "R3: transit for R5's SID" },
    { x: 530, head: "R5 → R6", labels: [{ text: "16006 S1" }], note: "R5 completed 16005" },
  ];
  return (
    <DiagramSvg h={180} label="R2 pushes R5's Node SID 16005 on top of the original 16006; R3 forwards 16005 unchanged toward R5; R5 completes it and forwards 16006 to R6">
      {cols.map((c) => (
        <g key={c.head}>
          <text x={c.x} y={20} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
            {c.head}
          </text>
          <DStack x={c.x} y={32} labels={c.labels} payload="IP" w={96} />
          <text x={c.x} y={128} textAnchor="middle" fill={D.muted} fontSize={9.5}>
            {c.note}
          </text>
        </g>
      ))}
      <text x={320} y={170} textAnchor="middle" fill={D.muted} fontSize={10}>
        no PHP is modeled in this lesson: R6 receives 16006 and completes it itself
      </text>
    </DiagramSvg>
  );
}

function StaleDiagram() {
  return (
    <DiagramSvg h={200} label="After R2-R3 becomes 25, R2's shortest path to R5 goes through R2-R4, so R5 is no longer in P-space and the old repair via R5 fails; R3 is still reachable safely">
      <rect x={20} y={20} width={290} height={140} rx={12} fill={D.box} stroke={D.danger} strokeOpacity={0.7} />
      <text x={36} y={42} fill={D.danger} fontSize={11.5} fontWeight={700}>
        Old repair (computed at R2-R3 = 15)
      </text>
      <text x={36} y={66} fill={D.text} fontSize={10.5} fontFamily="monospace">
        push 16005 (R5)
      </text>
      <text x={36} y={88} fill={D.muted} fontSize={10}>
        R2 → R5 now: via R2-R4 = 35
      </text>
      <text x={36} y={106} fill={D.muted} fontSize={10}>
        via R2-R3-R5 = 40
      </text>
      <text x={36} y={130} fill={D.danger} fontSize={10.5} fontWeight={700}>
        R5 left P-space → repair fails
      </text>
      <rect x={330} y={20} width={290} height={140} rx={12} fill={D.box} stroke={D.success} strokeOpacity={0.7} />
      <text x={346} y={42} fill={D.success} fontSize={11.5} fontWeight={700}>
        Against the current topology
      </text>
      <text x={346} y={66} fill={D.text} fontSize={10.5} fontFamily="monospace">
        repair point R3 → 16003
      </text>
      <text x={346} y={88} fill={D.muted} fontSize={10}>
        R2 → R3 direct = 25 (no R2-R4)
      </text>
      <text x={346} y={106} fill={D.muted} fontSize={10}>
        R3 → R6 via R5 = 30
      </text>
      <text x={346} y={130} fill={D.success} fontSize={10.5} fontWeight={700}>
        16003 S0 / 16006 S1
      </text>
      <text x={320} y={188} textAnchor="middle" fill={D.muted} fontSize={10}>
        the primary path never used R2-R3, so nothing looked broken until the failure
      </text>
    </DiagramSvg>
  );
}

function NodeProtectionDiagram() {
  return (
    <DiagramSvg h={240} label="Node protection excludes R4 entirely; in this topology the repair still goes via R5 because R2's path to R5 never touched R4">
      <SrTopology
        links={LINKS.map((l) => {
          const id = `${l.a}-${l.b}`;
          if (id === "R2-R4" || id === "R4-R6") return { ...l, color: D.danger, dashed: true };
          if (id === "R2-R3" || id === "R3-R5") return { ...l, color: D.warning, bold: true };
          return l;
        })}
        sub={{ R2: "PLR", R4: "protected node", R5: "repair point" }}
        accent={{ R2: D.warning, R4: D.danger, R5: D.success }}
        dim={["R4"]}
      />
      <DPill x={320} y={222} text="repair stack still 16005 S0 / 16006 S1" color={D.warning} w={260} />
    </DiagramSvg>
  );
}

export function TiLfaLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="tl-mission" eyebrow="This lesson" title="What this lesson teaches" tone="mpls">
        <p>
          The last lesson ended with a warning: when a link under an SR policy fails, the headend switches candidates — but only after IS-IS has told it, a second or so later. Customers notice a second. This lesson is about the routers right next to the failure repairing the traffic themselves, in tens of milliseconds, with a backup they computed long before anything broke: <b className="text-pv-text">Topology-Independent Loop-Free Alternate</b>, TI-LFA.
        </p>
        <p>You will follow R2 as it works out where traffic will go after a failure, turns that path into a single extra label, and installs it next to the primary. Then the link fails, then a whole router, then a link whose light never goes out — and finally an incident where the repair R2 had ready was no longer right.</p>
        <ChecklistCard tone="violet" title="By the end of this lesson you can" mark="→" items={["say which router is the point of local repair for each direction", "derive the post-convergence path, P-space, Q-space and the PQ node", "turn a post-convergence path into a repair segment list", "tell link from node protection, and classic LFA from TI-LFA", "explain why detection decides the outage, and what BFD does", "find a protection fault from evidence, fix it and prove it with a drill"]} />
      </GuideSection>

      <GuideSection id="tl-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="Numbers are IGP metrics. Green is the primary path.">
          <PrimaryDiagram />
        </DiagramFrame>
        <p>The SR-MPLS lesson&apos;s six routers, as a ring R2–R4–R6–R5–R3 with R1 hanging off R2: the top links have metric 10, the bottom ones 15. H1 (<Mono>192.168.1.10</Mono>) sits behind R1, H6 (<Mono>192.168.6.20</Mono>) behind R6; R1 and R6 exchange the customer prefixes by iBGP and the core runs no BGP. R1 reaches R6 over the top: R1 → R2 → R4 → R6, cost 30, pushing R6&apos;s Node SID <Mono>16006</Mono>.</p>
        <p>The R2–R4 link crosses a DWDM system. Keep that in mind: when it fails, neither router loses light.</p>
        <Callout tone="cyan" title="IOS XR and Junos in the lab" icon="i">
          The SR TI-LFA Lab runs either IOS XR (<Mono>fast-reroute per-prefix ti-lfa</Mono>) or Junos (<Mono>post-convergence-lfa</Mono>) on every router, with BFD on R2–R4. All output on this page is printed by the lab from the same network.
        </Callout>
      </GuideSection>

      <GuideSection id="tl-ideas" eyebrow="This lesson" title="Three ideas you need" tone="violet">
        <CompareCards
          items={[
            { title: "Local repair", tone: "warning", tag: "who", points: ["the router before the failure (PLR)", "no headend, no signaling"] },
            { title: "Post-convergence path", tone: "mpls", tag: "where", points: ["SPF without the failed link or node", "encoded as a few segments"] },
            { title: "Detection", tone: "violet", tag: "when", points: ["loss of light: at once", "silent failure: BFD or 30 s"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="tl-cost" eyebrow="The problem" title="The cost of waiting" tone="danger">
        <p>Start with no protection at all and fail R2–R4. BFD sees the silent failure after 150 ms — and then R2 has nothing to switch to. It floods a new LSP, every router reruns SPF, every router reprograms its labels; only then does traffic flow over R3 and R5. Both directions are dark for the whole time.</p>
        <TlDrill s={BARE} title="The lab: R2–R4 fails, no fast reroute anywhere" />
        <p>About a second. For a voice call that is a gap; for a trading feed or a storage replication it can be an outage. The fix is not a faster IGP — it is not needing the IGP at all for the first second.</p>
      </GuideSection>

      <GuideSection id="tl-plr" eyebrow="The idea" title="The point of local repair" tone="warning">
        <p>The router that sends traffic into the failure is the <b className="text-pv-text">point of local repair</b> (PLR). For H1 → H6 that is <b className="text-pv-text">R2</b>: it protects its link to R4 and, with node protection, the router R4 behind it. For H6 → H1 it is R4. Each PLR repairs by itself, from its own copy of the IS-IS database — the same database it already uses to route.</p>
        <Callout tone="warning" title="Each direction has its own PLR" icon="!">
          A failure on R2–R4 needs protection on <i>both</i> ends. Protect only R2, and the replies wait for convergence. Two of the lab&apos;s tickets are exactly that.
        </Callout>
      </GuideSection>

      <GuideSection id="tl-pq" eyebrow="Computing the backup" title="Post-convergence, P and Q" tone="mpls">
        <p>R2 asks: <i>where will traffic to R6 go once the network has converged without R2–R4?</i> It removes the link from its copy of the topology and reruns SPF: R2 → R3 → R5 → R6, cost 45. That is the <b className="text-pv-text">post-convergence path</b>. TI-LFA repairs onto exactly this path, so when IS-IS later converges, traffic doesn&apos;t move a second time.</p>
        <DiagramFrame caption="P-space from R2, Q-space toward R6, both without R2–R4.">
          <PqDiagram />
        </DiagramFrame>
        <p>Two sets tell R2 how to get onto that path with ordinary Node SIDs. <b className="text-pv-text">P-space</b>: the routers R2 already reaches without crossing R2–R4 — R1, R3, R5. <b className="text-pv-text">Q-space</b>: the routers whose own shortest path to R6 avoids R2–R4 — R3, R4, R5. A router in both is a <b className="text-pv-text">PQ node</b>: R2 can hand it the packet, and it will hand it on to R6, with no one in between aware of the failure. R5 is the one closest to R6.</p>
        <CliPanel run={tlOnly(X0, "R2", "show isis fast-reroute 10.0.0.6/32 detail", /^L2|via|Backup path|P node|Prefix label|NP:/)} caption="IOS XR · R2 — primary via R4, TI-LFA (node) backup via R3, P node R5" />
      </GuideSection>

      <GuideSection id="tl-list" eyebrow="Computing the backup" title="The repair segment list" tone="mpls">
        <p>R2 now writes the post-convergence path as segments, as few as possible. Its own shortest path to R5 already runs R2 → R3 → R5, the beginning of the post-convergence path: one Node SID, <Mono>16005</Mono>, covers it. From R5, the shortest path to R6 is direct: the destination&apos;s own <Mono>16006</Mono> covers the rest. The repair is <Mono>[16005]</Mono> above 16006.</p>
        <p>When no single router is in both spaces, TI-LFA bridges P to Q with an <b className="text-pv-text">Adjacency SID</b> — &quot;take this link&quot; — which works in any topology. That is the &quot;topology-independent&quot; part, and the Deep Dive works through one.</p>
        <CliPanel run={tlBlock(J0, "R2", "show isis backup spf results", /^R6\.00/, /^\S|^  \d+ nodes/, "IS-IS level 2 SPF results:")} caption="Junos · R2 — the same backup: via R3, label 16005, post-convergence path" />
      </GuideSection>

      <GuideSection id="tl-wire" eyebrow="Data plane" title="Local repair on the wire" tone="warning">
        <DiagramFrame caption="The guided lesson keeps every label to its target to make the stack visible.">
          <RepairWireDiagram />
        </DiagramFrame>
        <p>When the repair is in use, R2 sends <Mono>16005 | 16006</Mono> out of its R3 interface. R3 swaps 16005 toward R5; R5 recognizes its own SID and removes it, then forwards 16006 toward R6.</p>
        <Callout tone="cyan" title="With penultimate-hop popping" icon="i">
          The guided lesson lets R5 and R6 receive their own labels to keep each step visible. Real routers — and the lab — pop a Node SID one hop early by default: R3 pops 16005 toward R5, R5 pops 16006 toward R6, and R6 receives plain IP. The repair is the same; only the last hop of each segment changes.
        </Callout>
        <CliPanel run={tlOnly(X0, "R2", "show mpls forwarding labels 16006 detail", /^16006|^\s+16006|Label Stack/)} caption="IOS XR · R2 — the primary (16006 toward R4) and the (!) backup with stack {16005 16006} toward R3" />
      </GuideSection>

      <GuideSection id="tl-ready" eyebrow="Data plane" title="Installed is not active" tone="success">
        <p>All of this happens before any failure. R2&apos;s routing table shows the primary path as <b className="text-pv-text">Protected</b> and the backup next to it; its forwarding table already holds both. While R2–R4 is up, the backup carries nothing — it is ready, not active.</p>
        <CliPanel run={tlOnly(X0, "R2", "show route 10.0.0.6", /Routing entry|Known via|via GigabitEthernet|Repair Node|Route metric|Label/)} caption="IOS XR · R2 — primary Protected, Backup (TI-LFA) via R3 with labels 16005 16006" />
      </GuideSection>

      <GuideSection id="tl-fail" eyebrow="The failure" title="The failure, both directions" tone="danger">
        <p>Now R2–R4 fails. BFD on both ends detects it after 150 ms (3 × 50 ms). R2 switches H1 → H6 to its backup in about 15 ms; R4 does the same for H6 → H1, pushing <Mono>[16005]</Mono> above R1&apos;s <Mono>16001</Mono> back toward R6. Behind them IS-IS converges onto the same paths, and the backups are recomputed for the new topology.</p>
        <TlDrill s={HEALTHY} title="The lab: R2–R4 fails, TI-LFA and BFD on both ends" />
        <p>Look at H6 → H1 during the repair: R6 → R4 → R6 → R5 … R6 still believes its best way to R1 is through R4 — it hasn&apos;t heard of the failure yet — so R4 turns the packet around. A moment later R6 converges and sends to R5 directly.</p>
      </GuideSection>

      <GuideSection id="tl-node" eyebrow="The failure" title="Node protection" tone="warning">
        <DiagramFrame caption="Node protection removes R4 and every link into it.">
          <NodeProtectionDiagram />
        </DiagramFrame>
        <p>With node protection, R2 computes its backup without R4 at all. In this ring the result is the same — R5 never needed R4 — but now it is also valid when R4 itself dies. When it does, its links lose light: detection is 10 ms. For H6 → H1 the PLR becomes <b className="text-pv-text">R6</b>, whose next hop R4 is gone; R6 pushes <Mono>[16003]</Mono> toward R5.</p>
        <TlDrill s={NODE} title="The lab: router R4 fails" />
      </GuideSection>

      <GuideSection id="tl-lfa" eyebrow="Why TI" title="Why not classic LFA" tone="violet">
        <p>Classic LFA (RFC 5286) needs no labels: the PLR sends to a neighbor whose own shortest path to the destination doesn&apos;t come back through the PLR. R2 has one — R3 reaches R6 in 30, less than going back through R2 (35). R4 has none for R1: its only other neighbor, R6, reaches R1 through R4 (30 = 10 + 20, not less). Switch R4 to classic LFA only and fail R2–R4:</p>
        <TlDrill s={LFA} title="The lab: R4 runs classic LFA only" />
        <p>TI-LFA solves R4&apos;s problem with a label: <Mono>16005</Mono> changes R6&apos;s question from &quot;shortest path to R1&quot; (back through R4) to &quot;shortest path to R5&quot; (direct). Any post-convergence path can be written that way, so TI-LFA protects every destination that has any path left.</p>
      </GuideSection>

      <GuideSection id="tl-detect" eyebrow="Detection" title="Detection is half the outage" tone="danger">
        <p>A backup is only used once the PLR knows something failed. A cut fiber drops the light and the interface goes down in milliseconds. A fault inside a DWDM system or a provider&apos;s network leaves the light on: the interface stays up, and only IS-IS notices — when no hello has arrived for the whole <b className="text-pv-text">hold time</b>, 30 s here.</p>
        <TlDrill s={NOBFD} title="The lab: R2–R4 fails with BFD removed from both ends" />
        <p><b className="text-pv-text">BFD</b> (RFC 5880) exchanges tiny packets every 50 ms; three missed ones bring the session down, and IS-IS, registered as a BFD client, drops the adjacency at once. It must run on both ends: a one-sided BFD session never comes up.</p>
        <CliPanel run={tlCli(X0, "R2", "show bfd session")} caption="IOS XR · R2 — BFD toward R4: 150 ms detection (50 ms × 3), UP" />
      </GuideSection>

      <GuideSection id="tl-limits" eyebrow="Limits" title="When protection is unavailable" tone="warning">
        <p>TI-LFA needs a path to exist. R1 has a single link: nothing can protect it, and R1&apos;s own fast-reroute summary shows every destination unprotected. Every router on the post-convergence path must also execute the repair&apos;s labels. Disable segment routing on R3 — every way around R2–R4 passes through it — and R2 and R4 compute no backup at all:</p>
        <CliPanel run={tlOnly(NOSR3, "R2", "show isis fast-reroute 10.0.0.6/32 detail", /^L2|via|No FRR/)} caption="IOS XR · R2 — no backup for 10.0.0.6 while R3 runs no SR" />
        <TlDrill s={NOSR3} title="The lab: R2–R4 fails while R3 runs no SR" />
      </GuideSection>

      <GuideSection id="tl-stale" eyebrow="Incident" title="The stale-repair incident" tone="danger">
        <p>In the guided lesson, the R2–R3 metric was raised to 25 for maintenance. Nothing looked wrong: the primary path never used R2–R3. Then R2–R4 failed, and R2&apos;s repair — still <Mono>[16005]</Mono>, computed for the old topology — sent traffic toward R5 on R2&apos;s new shortest path to R5… over the failed link.</p>
        <DiagramFrame caption="Why the old repair fails, and what the current topology gives.">
          <StaleDiagram />
        </DiagramFrame>
        <TroubleshootingFlow
          steps={[
            { question: "Did the repair activate?", look: "Yes — R2 pushed 16005 the moment the link failed." },
            { question: "Where does 16005 go from R2 now?", look: "Via R4: R2 → R5 costs 35 over R4, 40 over R3." },
            { question: "Is R5 still in P-space?", look: "No. The repair point must be recomputed against today's topology." },
            { question: "What is the right repair?", look: "R3 (16003): reachable directly, and R3 reaches R6 via R5." },
          ]}
        />
        <p>Real routers recompute TI-LFA after every SPF run, so a metric change normally brings a fresh backup within a second. The lab shows it: set R2–R3 to 25 and R2&apos;s repair point becomes R3 — repair segment <Mono>16003</Mono> — by itself. Because R3 is R2&apos;s own neighbor, R2 executes that segment on the spot: only 16006 goes out toward R3, and IOS XR prints the P node&apos;s label as ImpNull. (The guided lesson keeps 16003 on the wire to make the segment visible.) The lesson stands, though — a backup is only as good as the topology it was computed for, and the proof is a drill, not a configuration.</p>
        <CliPanel run={tlOnly(M25, "R2", "show isis fast-reroute 10.0.0.6/32 detail", /^L2|via|Backup path|P node|Prefix label/)} caption="IOS XR · R2 after R2–R3 = 25 — P node R3 (its neighbor: ImpNull), then 16006" />
        <TlDrill s={M25} title="The lab: R2–R4 fails after the metric change" />
      </GuideSection>

      <GuideSection id="tl-working" eyebrow="Evidence" title="What working looks like" tone="success">
        <FieldTable
          title="Healthy, in five questions (on each PLR)"
          accent="success"
          columns={["Question", "IOS XR · Junos", "Healthy answer"]}
          rows={[
            ["A backup for the destination?", <Mono key="1">show isis fast-reroute 10.0.0.6/32 detail · show isis backup spf results</Mono>, "TI-LFA (node) via R3, P node R5, 16005"],
            ["Installed in forwarding?", <Mono key="2">show mpls forwarding labels 16006 detail · show route table mpls.0</Mono>, "(!) backup row, stack {16005 16006}"],
            ["How much is protected?", <Mono key="3">show isis fast-reroute summary · show isis backup coverage</Mono>, "R2: 4 of 5 (not R1 — single link)"],
            ["Fast detection on silent links?", <Mono key="4">show bfd session</Mono>, "R2–R4 UP, 150 ms"],
            ["Does it work?", "a failure drill", "both directions repaired locally, ~165 ms"],
          ]}
        />
      </GuideSection>

      <GuideSection id="tl-other" eyebrow="Beyond this incident" title="Other ways it fails" tone="warning">
        <FailureSignatures
          items={[
            { tag: "PLR", title: "No fast reroute on the PLR", tone: "danger", points: ["no backup on that interface", "one direction ~1 s"] },
            { tag: "END", title: "Protected on one end only", tone: "danger", points: ["requests fine", "replies wait (or the reverse)"] },
            { tag: "BFD", title: "No BFD on a silent link", tone: "warning", points: ["backup ready, unused", "~30 s"] },
            { tag: "SR", title: "No SR on the way around", tone: "violet", points: ["no backup computed", "lost until repaired"] },
            { tag: "LFA", title: "Classic LFA only", tone: "warning", points: ["backup missing where no loop-free neighbor exists"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Each is a ticket in the SR TI-LFA Lab.</p>
      </GuideSection>

      <GuideSection id="tl-model" eyebrow="Mental model" title="Mental model" tone="cyan">
        <p>
          Think of a motorway junction with a traffic officer who studies the map every morning. For every destination she asks: if the bridge ahead closed, which way would the satnavs send everyone once they found out? She writes that detour on a card — not every turn, just &quot;go to the Riverside interchange first&quot;, because from her junction the normal signs already lead there, and from Riverside the normal signs lead home. When the bridge closes, she doesn&apos;t wait for the radio: she hands out the cards. The radio catches up later and the satnavs choose the very same detour, so nobody has to turn around twice. Two things can still go wrong: she has to hear the bridge close — a closure nobody reports stays invisible until the timeout — and every interchange on the detour must read the cards.
        </p>
        <Callout tone="cyan" title="When it breaks, ask in this order" icon="→">
          Which direction lost traffic, and for how long? Which router is the PLR for it? How fast did it detect the failure? Does it have a backup for the destination? Can every router on the repair execute it? Then fix one thing and run the drill again.
        </Callout>
      </GuideSection>

      <GuideSection id="tl-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "PLR", def: "Point of local repair: the router that sends traffic into the failure and switches it to the backup." },
            { term: "Post-convergence path", def: "The shortest path once the network has converged without the failed link or node." },
            { term: "P-space", def: "Routers the PLR reaches without crossing the protected resource." },
            { term: "Q-space", def: "Routers that reach the destination without crossing the protected resource." },
            { term: "PQ node", def: "A router in both: the repair delivers to it, it delivers to the destination." },
            { term: "Repair list", def: "The segments the PLR pushes above the destination's label." },
            { term: "Classic LFA", def: "A loop-free neighbor used as backup without extra labels (RFC 5286)." },
            { term: "TI-LFA", def: "A backup along the post-convergence path, encoded with SR segments; works in any topology." },
            { term: "BFD", def: "Bidirectional Forwarding Detection: fast liveness check that IS-IS uses to detect silent failures." },
          ]}
        />
      </GuideSection>

      <GuideSection id="tl-recap" eyebrow="Reference" title="Recap" tone="success">
        <ChecklistCard tone="success" title="You can now" mark="✓" items={["name the PLR for each direction of a flow", "derive post-convergence path, P, Q and the PQ node", "write the repair list and read it in the CLI", "tell link from node protection and LFA from TI-LFA", "explain detection and BFD", "find, fix and prove a protection fault with a drill"]} />
      </GuideSection>

      <GuideSection id="tl-practice" eyebrow="Next" title="Practice it" tone="violet">
        <p>The Deep Dive tab covers TI-LFA in full: LFA, remote LFA and TI-LFA, P- and Q-space and their extended forms, encoding with Adjacency SIDs, link, node and SRLG protection, microloops, detection and timers, configuration and verification on IOS XR and Junos, and every failure signature with real evidence. The lab lets you break it.</p>
        <LessonLabBridge />
        <PresentationBridge>Rewatch the SR TI-LFA presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
