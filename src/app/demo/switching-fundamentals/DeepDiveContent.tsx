"use client";

import type { ReactNode } from "react";
import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, FailureSignatures, FieldTable, FlowSteps, GuideSection, Misconceptions, Mono, PacketAnatomy, StateTransition, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { ExplainIt, KnowledgeCheck, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { executeCli } from "@/lib/cli/parser";
import { ciscoMac } from "@/lib/cli/format";
import type { CliVendor } from "@/lib/cli/types";
import { BROADCAST_MAC, PRIMARY_PORT, SECONDARY_PORT, SWF_MAC, type SwfHost, type SwfSwitch } from "@/lib/sim-engine/scenarios/switchingFundamentals";
import { SN_WAVES, createSwitchNet, snApply, snCirculating, snHealthy, snLookup, snPortRole, type SnAction, type SnState } from "@/lib/sim-engine/scenarios/switchNet";
import { snSwitchSets } from "./switching-lab/snCli";
import { BroadcastDiagram, FirstFrameDiagram, LoopDiagram, RepairDiagram, ReplyDiagram, TopologyDiagram, TwoLookupsDiagram } from "./LessonGuideContent";
import { HostNote, SwNote, TwoSwitches } from "./guideSvg";

/**
 * MULTI-SWITCH FORWARDING DEEP DIVE — the complete lesson, taught on ONE network: the exact SW1 / SW2 /
 * HOST-A·B·C·D topology (ge-0/0/23 primary, ge-0/0/24 secondary) of the guided lesson and the Switching Lab. Every
 * MAC and port comes from switchingFundamentals.ts, and every table and CLI sample below is produced by running the
 * Switching Lab model to that point and executing the real SW1 / SW2 CLI adapter — guide, lesson and lab can't drift.
 *
 * Progression: Foundation → Learning across switches → Forwarding decisions → Operations → Troubleshooting →
 * Beyond this lesson → Master it.
 */

const G = { foundation: "Foundation", learn: "Learning across switches", forward: "Forwarding decisions", ops: "Operations", trouble: "Troubleshooting", beyond: "Beyond this lesson", master: "Master it" };

export const SWF_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "swd-why", label: "Why multiple switches", group: G.foundation },
  { id: "swd-independent", label: "Every bridge learns independently", group: G.foundation },
  { id: "swd-nosync", label: "Tables are not synchronized", group: G.foundation },
  { id: "swd-local", label: "Local vs inter-switch entries", group: G.foundation },
  { id: "swd-source", label: "Source learning on two switches", group: G.learn },
  { id: "swd-unknown", label: "Unknown-unicast propagation", group: G.learn },
  { id: "swd-return", label: "Return-path learning", group: G.learn },
  { id: "swd-known", label: "Known unicast: two decisions", group: G.learn },
  { id: "swd-localsw", label: "Local switching", group: G.learn },
  { id: "swd-never", label: "Why SW2 doesn't learn HOST-D", group: G.learn },
  { id: "swd-partial", label: "Partial knowledge", group: G.forward },
  { id: "swd-floodfwd", label: "One floods, one forwards", group: G.forward },
  { id: "swd-broadcast", label: "Broadcast across the domain", group: G.forward },
  { id: "swd-compare", label: "The same MAC on SW1 and SW2", group: G.forward },
  { id: "swd-frame", label: "The frame is preserved", group: G.forward },
  { id: "swd-ttl", label: "No TTL in Ethernet", group: G.forward },
  { id: "swd-cli", label: "Cisco and Junos verification", group: G.ops },
  { id: "swd-trace", label: "Tracing a MAC switch by switch", group: G.ops },
  { id: "swd-links", label: "Interface and link state", group: G.ops },
  { id: "swd-workflow", label: "Troubleshooting workflow", group: G.trouble },
  { id: "swd-signatures", label: "Failure signatures", group: G.trouble },
  { id: "swd-flap", label: "MAC flapping", group: G.trouble },
  { id: "swd-incident", label: "The loop incident", group: G.trouble },
  { id: "swd-forever", label: "Why a loop never stops", group: G.trouble },
  { id: "swd-stp", label: "Loop prevention (STP preview)", group: G.beyond },
  { id: "swd-domains", label: "Collision vs broadcast domains", group: G.beyond },
  { id: "swd-myths", label: "Common misconceptions", group: G.master },
  { id: "swd-quiz", label: "Knowledge check", group: G.master },
  { id: "swd-explain", label: "Can you explain it?", group: G.master },
  { id: "swd-practice", label: "Practice in the Switching Lab", group: G.master },
];

// ------------------------------------------------------------------ network facts (one source)

const P = PRIMARY_PORT;
const S2 = SECONDARY_PORT;
const A = SWF_MAC["HOST-A"];
const B = SWF_MAC["HOST-B"];
const Dm = SWF_MAC["HOST-D"];
const HOSTS: SwfHost[] = ["HOST-A", "HOST-B", "HOST-C", "HOST-D"];

// The Switching Lab's own model (switchNet.ts) produces every state below — and so every table and CLI sample.
const play = (s: SnState, actions: SnAction[]) => actions.reduce(snApply, s);
const send = (src: SwfHost, dst: SwfHost | "broadcast", arpFor?: SwfHost): SnAction => ({ type: "traffic", sends: [dst === "broadcast" ? { from: src, to: "broadcast", arpFor } : { from: src, to: dst }] });
const withSecond = (on: boolean): SnAction => {
  const cfg = snHealthy();
  if (on) {
    cfg.sw.SW1.shut = [];
    cfg.sw.SW2.shut = [];
  }
  return { type: "cfg", cfg, text: on ? `${SECONDARY_PORT} enabled on both switches` : `${SECONDARY_PORT} disabled on both switches` };
};
const LAB_T0 = createSwitchNet();
const LAB_T1 = play(LAB_T0, [send("HOST-A", "HOST-B")]);
const LAB_T2 = play(LAB_T1, [send("HOST-B", "HOST-A")]);
const LAB_T3 = play(LAB_T2, [send("HOST-A", "HOST-B")]);
const LAB_T4 = play(LAB_T3, [send("HOST-D", "HOST-A"), send("HOST-A", "HOST-D")]);
const LAB_T5 = play(LAB_T4, [send("HOST-C", "HOST-D")]);
const LAB_T6 = play(LAB_T5, [send("HOST-D", "broadcast", "HOST-C")]);
const LAB_LOOP = play(LAB_T6, [withSecond(true), send("HOST-A", "broadcast", "HOST-B")]);
const LAB_SYMPTOM = play(LAB_LOOP, [send("HOST-D", "HOST-A")]);
const LAB_REPAIRED = play(LAB_SYMPTOM, [withSecond(false)]);
const LAB_VERIFIED = play(LAB_REPAIRED, [send("HOST-A", "broadcast", "HOST-B"), send("HOST-B", "HOST-A")]);
const copiesOf = (s: SnState) => {
  const r = s.last;
  if (!r) return undefined;
  const id = r.results[0]?.frame.id;
  return Object.fromEntries(HOSTS.map((h) => [h, r.waves.flatMap((w) => w.rx).filter((x) => x.host === h && x.frame.id === id).reduce((n, x) => n + x.n, 0)])) as Record<SwfHost, number>;
};
const LOOP_COPIES = copiesOf(LAB_LOOP);
const VERIFY_COPIES = copiesOf(play(LAB_REPAIRED, [send("HOST-A", "broadcast", "HOST-B")]));
const LOOP_MOVES = LAB_LOOP.moves.filter((m) => m.run === LAB_LOOP.last?.id);

function cli(state: SnState, sw: SwfSwitch, vendor: CliVendor, command: string) {
  const api = { view: state, act: () => state, ios: { SW1: { kind: "exec" as const }, SW2: { kind: "exec" as const } }, setIos: () => undefined, junosEdit: { SW1: false, SW2: false }, setJunosEdit: () => undefined, cand: state.cfg.sw, setCand: () => undefined };
  const set = snSwitchSets(api, sw)[vendor]!;
  const r = executeCli(set, command);
  return { prompt: set.prompt, command, output: r.kind === "ok" ? r.output : "" };
}

const portOf = (s: SnState, sw: SwfSwitch, host: SwfHost) => snLookup(s.cfg, s.fdb, sw, SWF_MAC[host])?.port;
const Strong = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;

function CliPanel({ prompt, command, output, caption }: { prompt: string; command: string; output: string; caption?: string }) {
  return (
    <figure className="min-w-0">
      {caption && <figcaption className="mb-1 text-[10px] font-bold uppercase tracking-wide text-pv-text-faint">{caption}</figcaption>}
      <div className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-[#05080d]">
        <pre className="overflow-x-auto px-3 py-2 pv-mono text-[10.5px] leading-relaxed text-pv-text-muted">
          <span className="text-pv-success">{prompt}</span>
          <span className="text-pv-text">{command}</span>
          {"\n"}
          {output}
        </pre>
      </div>
    </figure>
  );
}

/** One switch's table at a lab state, with what each entry means from that switch's position. */
const fdbRows = (s: SnState, sw: SwfSwitch) => (s.fdb[sw].length ? s.fdb[sw].map((e) => [<Mono key="m">{e.mac}</Mono>, e.port, snPortRole(s.cfg, sw, e.port)]) : [["(empty)", "", ""]]);
/** Both switches' answer for every host at a lab state. */
const compareRows = (s: SnState) => HOSTS.map((h) => [h, portOf(s, "SW1", h) ?? "no entry", portOf(s, "SW2", h) ?? "no entry"]);

/** Local practice bridge: opens the Switching Lab when the guide is shown inside the lesson (renders nothing otherwise). */
function LabBridge({ label, children }: { label: string; children: ReactNode }) {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label={label} onPractice={openLab}>
      {children}
    </PracticeBridge>
  );
}

// ------------------------------------------------------------------ diagrams (deep-dive specific)

function PipelineDiagram() {
  const stages = [
    { t: "Receive", s: "check FCS", c: D.eth },
    { t: "Learn", s: "SOURCE → ingress", c: D.warning },
    { t: "Look up", s: "DESTINATION", c: D.cyan },
    { t: "Decide", s: "forward/flood/filter", c: D.violet },
    { t: "Transmit", s: "frame unchanged", c: D.success },
  ];
  return (
    <DiagramSvg h={150} label="Bridge pipeline: receive and check FCS, learn the source MAC against the ingress port, look up the destination MAC, decide to forward, flood or filter, transmit the frame unchanged">
      {stages.map((st, i) => (
        <g key={st.t}>
          <DNode x={70 + i * 125} y={60} label={st.t} sub={st.s} accent={st.c} w={112} h={48} />
          {i < stages.length - 1 && <DArrow x1={128 + i * 125} y1={60} x2={137 + i * 125} y2={60} color={D.muted} width={1.6} />}
        </g>
      ))}
      <text x={320} y={118} textAnchor="middle" fill={D.muted} fontSize={10}>
        Learning uses only the source field. Forwarding uses only the destination field.
      </text>
      <text x={320} y={136} textAnchor="middle" fill={D.muted} fontSize={10}>
        SW1 runs this pipeline; then SW2 runs it again, from scratch, with its own table.
      </text>
    </DiagramSvg>
  );
}

function ViewsDiagram() {
  return (
    <DiagramSvg h={250} label={`Local versus inter-switch entries: SW1 sees HOST-A and HOST-D on local ports and HOST-B and HOST-C behind ${P}; SW2 sees the reverse`}>
      <TwoSwitches primary="idle" secondary="down" subs={{ SW1: "A, D local", SW2: "B, C local" }}>
        <SwNote sw="SW1" dy={-44} text={`B, C → ${P}`} color={D.violet} />
        <SwNote sw="SW2" dy={-44} text={`A, D → ${P}`} color={D.violet} />
      </TwoSwitches>
      <text x={320} y={242} textAnchor="middle" fill={D.muted} fontSize={10}>
        An entry on an inter-switch port means &quot;beyond the other switch&quot; — never which port over there.
      </text>
    </DiagramSvg>
  );
}

function LocalDiagram() {
  return (
    <DiagramSvg h={250} label="Local switching: HOST-D sends to HOST-A; SW1 knows HOST-A on ge-0/0/1 and forwards there only; nothing crosses the inter-switch link and SW2 receives nothing">
      <TwoSwitches hosts={{ D: "in", A: "out" }} primary="idle" secondary="down" subs={{ SW1: "HIT A", SW2: "saw nothing" }}>
        <SwNote sw="SW1" dy={-44} text="learn D → ge-0/0/2" color={D.warning} />
        <SwNote sw="SW2" dy={-44} text="no frame → no learning" color={D.muted} />
      </TwoSwitches>
      <text x={320} y={242} textAnchor="middle" fill={D.muted} fontSize={10}>
        The frame never reaches SW2 — so SW2 cannot learn HOST-D from it.
      </text>
    </DiagramSvg>
  );
}

function PartialDiagram() {
  return (
    <DiagramSvg h={250} label="Partial knowledge: HOST-C sends to HOST-D; SW2 has no entry for HOST-D and floods to HOST-B and SW1; SW1 has HOST-D on ge-0/0/2 and forwards to that port only">
      <TwoSwitches hosts={{ C: "in", B: "out", D: "out" }} primary="left" secondary="down" subs={{ SW1: "HIT D", SW2: "MISS D" }}>
        <SwNote sw="SW2" dy={-44} text="unknown → flood" color={D.warning} />
        <SwNote sw="SW1" dy={-44} text="known → ge-0/0/2" color={D.success} />
        <HostNote h="B" text="discards" color={D.danger} />
        <HostNote h="D" text="accepts" color={D.success} />
      </TwoSwitches>
      <text x={320} y={242} textAnchor="middle" fill={D.muted} fontSize={10}>
        One frame, two bridges, two different answers — both correct for their own table.
      </text>
    </DiagramSvg>
  );
}

function DomainsDiagram() {
  const ports = [
    { x: 80, y: 60, t: "HOST-A" },
    { x: 80, y: 150, t: "HOST-D" },
    { x: 560, y: 60, t: "HOST-B" },
    { x: 560, y: 150, t: "HOST-C" },
  ];
  return (
    <DiagramSvg h={250} label="Collision domains versus broadcast domain: every full-duplex switch port is its own link with no collisions; all four hosts and both switches form one broadcast domain">
      <rect x={16} y={14} width={608} height={186} rx={16} fill={D.warning} fillOpacity={0.04} stroke={D.warning} strokeOpacity={0.45} strokeDasharray="6 5" />
      <text x={30} y={32} fill={D.warning} fontSize={10} fontWeight={700}>
        ONE broadcast domain (both switches)
      </text>
      {ports.map((p) => (
        <g key={p.t}>
          <rect x={p.x - 62} y={p.y - 30} width={124} height={60} rx={10} fill={D.cyan} fillOpacity={0.05} stroke={D.cyan} strokeOpacity={0.5} />
          <DNode x={p.x} y={p.y + 4} label={p.t} w={96} h={34} />
        </g>
      ))}
      <DNode x={240} y={105} label="SW1" accent={D.violet} w={80} h={36} />
      <DNode x={400} y={105} label="SW2" accent={D.violet} w={80} h={36} />
      <DLink x1={280} y1={105} x2={360} y2={105} color={D.violet} />
      <DLink x1={142} y1={70} x2={200} y2={98} color={D.line} />
      <DLink x1={142} y1={146} x2={200} y2={112} color={D.line} />
      <DLink x1={440} y1={98} x2={498} y2={70} color={D.line} />
      <DLink x1={440} y1={112} x2={498} y2={146} color={D.line} />
      <text x={30} y={224} fill={D.cyan} fontSize={10} fontWeight={700}>
        Each cyan box: one full-duplex link = its own collision domain (no collisions at all).
      </text>
      <text x={30} y={242} fill={D.muted} fontSize={10}>
        Switches separate collision domains. Only a router (or a VLAN boundary) separates broadcast domains.
      </text>
    </DiagramSvg>
  );
}

function FlapDiagram() {
  const steps = [
    { port: "ge-0/0/1", why: "HOST-A's real frame", c: D.success },
    { port: P, why: "looped copy returns", c: D.danger },
    { port: S2, why: "other looped copy", c: D.danger },
    { port: "…", why: "every further wave", c: D.danger },
  ];
  return (
    <DiagramSvg h={170} label={`MAC flapping on SW1: HOST-A's entry is learned on ge-0/0/1 from the real frame, then on ${P} and ${S2} as looped copies with the same source MAC arrive`}>
      <text x={20} y={24} fill={D.text} fontSize={10.5} fontWeight={700}>
        SW1&apos;s entry for HOST-A during the loop (the same source MAC every time)
      </text>
      {steps.map((st, i) => (
        <g key={i}>
          <DNode x={85 + i * 155} y={80} label={st.port} sub={st.why} accent={st.c} w={130} h={48} />
          {i < steps.length - 1 && <DArrow x1={152 + i * 155} y1={80} x2={173 + i * 155} y2={80} color={D.muted} width={1.6} />}
        </g>
      ))}
      <text x={20} y={140} fill={D.muted} fontSize={10}>
        Source learning is working exactly as designed — the loop keeps delivering the same source on new ports.
      </text>
      <text x={20} y={158} fill={D.muted} fontSize={10}>
        HOST-A never moved. The entry moves because looped copies carry HOST-A&apos;s MAC into other ports.
      </text>
    </DiagramSvg>
  );
}

function NoTtlDiagram() {
  return (
    <DiagramSvg h={190} label="An IPv4 packet carries a TTL that each router decrements, so a looping packet is eventually dropped; an Ethernet header has only destination, source and EtherType, so a looping frame is never dropped by the switches">
      <text x={20} y={26} fill={D.ip} fontSize={10.5} fontWeight={700}>
        IPv4 packet looping between routers
      </text>
      {[64, 63, 62, "…", 0].map((t, i) => (
        <DPill key={i} x={70 + i * 90} y={50} text={`TTL ${t}`} color={i === 4 ? D.danger : D.ip} />
      ))}
      <text x={520} y={54} fill={D.danger} fontSize={10}>
        → dropped
      </text>
      <text x={20} y={104} fill={D.eth} fontSize={10.5} fontWeight={700}>
        Ethernet frame looping between bridges
      </text>
      {[1, 2, 3, 4, 5].map((n, i) => (
        <DPill key={n} x={70 + i * 90} y={128} text={i === 4 ? "pass …" : `pass ${n}`} color={D.eth} />
      ))}
      <text x={520} y={132} fill={D.danger} fontSize={10}>
        → never
      </text>
      <text x={20} y={174} fill={D.muted} fontSize={10}>
        Dst MAC · Src MAC · EtherType — nothing in the Ethernet header counts down, and a bridge never changes it.
      </text>
    </DiagramSvg>
  );
}

function PreventionDiagram() {
  return (
    <DiagramSvg h={250} label="Loop prevention concept: both SW1 to SW2 links stay cabled for redundancy, but a loop-prevention protocol keeps only one forwarding and holds the other in a non-forwarding state until it is needed">
      <TwoSwitches primary="both" secondary="down" subs={{ SW1: "redundant", SW2: "redundant" }}>
        <SwNote sw="SW1" dy={-44} text={`${P.slice(-2)}: forwarding`} color={D.success} />
        <SwNote sw="SW2" dy={-44} text={`${S2.slice(-2)}: held non-forwarding`} color={D.warning} />
      </TwoSwitches>
      <text x={320} y={242} textAnchor="middle" fill={D.muted} fontSize={10}>
        Keep the cable, keep the redundancy — let a protocol decide which link forwards (STP, a later lesson).
      </text>
    </DiagramSvg>
  );
}

// ------------------------------------------------------------------ knowledge checks

const QUIZ: KnowledgeQuestion[] = [
  { id: "q1", prompt: "HOST-A's first frame reaches SW2 on its link to SW1. Where does SW2 learn HOST-A?", options: [{ id: "a", label: `${P} — the port the frame arrived on` }, { id: "b", label: "ge-0/0/1 — copied from SW1" }, { id: "c", label: "Nowhere: only the first switch learns" }], correctId: "a", explanation: "Every bridge learns from frames on its OWN ports. From SW2's position, HOST-A is behind the link to SW1." },
  { id: "q2", prompt: "SW1 knows HOST-D. Does that mean SW2 knows HOST-D?", options: [{ id: "a", label: "Yes — switches synchronize tables" }, { id: "b", label: "Only if SW2 has received a frame sourced by HOST-D" }, { id: "c", label: "Yes, after a few seconds" }], correctId: "b", explanation: "There is no table synchronization. HOST-D's local traffic to HOST-A never crossed the link, so SW2 knew nothing until HOST-D's broadcast reached it." },
  { id: "q3", prompt: "HOST-C sends to HOST-D. SW2 floods it. What does SW1 do?", options: [{ id: "a", label: "Floods too — a flooded frame stays flooded" }, { id: "b", label: "Its own lookup: HOST-D known on ge-0/0/2 → forwards there only" }, { id: "c", label: "Drops it" }], correctId: "b", explanation: "Each switch decides from its own table. The copy SW1 receives is just a unicast frame to HOST-D's MAC." },
  { id: "q4", prompt: "HOST-A's frame crosses SW1 and SW2. What source MAC does HOST-B see?", options: [{ id: "a", label: "SW2's MAC" }, { id: "b", label: `HOST-A's MAC (${A})` }, { id: "c", label: "SW1's MAC" }], correctId: "b", explanation: "Bridges forward frames unchanged. Rewriting MACs is what a router does, hop by hop." },
  { id: "q5", prompt: `Both ${P} and ${S2} forward, with no loop prevention. HOST-A sends one broadcast. What happens?`, options: [{ id: "a", label: "Every host gets one copy" }, { id: "b", label: "Copies circulate between the switches and never expire" }, { id: "c", label: "The copies die after a few hops (TTL)" }], correctId: "b", explanation: "Each switch floods the broadcast out both inter-switch links; each copy returns on the other. Ethernet has no TTL, so nothing ends it." },
  { id: "q6", prompt: "SW1 logs HOST-A's MAC moving between ge-0/0/1, ge-0/0/23 and ge-0/0/24. Root cause?", options: [{ id: "a", label: "MAC flapping" }, { id: "b", label: "A Layer-2 loop delivering HOST-A's frames on several ports" }, { id: "c", label: "HOST-A's NIC is faulty" }], correctId: "b", explanation: "Flapping is the symptom; the loop is the cause. Fix the loop and the entry settles on ge-0/0/1." },
  { id: "q7", prompt: "The loop is happening. Which change actually stops it?", options: [{ id: "a", label: "Clear both MAC tables" }, { id: "b", label: `Disable ${S2} on both switches` }, { id: "c", label: "Raise HOST-A's IPv4 TTL" }], correctId: "b", explanation: "Clearing tables changes nothing about the second path — the circulating copies relearn the same entries. Removing the second forwarding path removes the loop." },
];

// ------------------------------------------------------------------ content

export function SwitchingDeepDiveContent() {
  const t1a = cli(LAB_T1, "SW1", "cisco", `show mac address-table address ${ciscoMac(A)}`);
  const t1b = cli(LAB_T1, "SW2", "cisco", `show mac address-table address ${ciscoMac(A)}`);
  const t2j1 = cli(LAB_T2, "SW1", "juniper", "show ethernet-switching table");
  const t2j2 = cli(LAB_T2, "SW2", "juniper", "show ethernet-switching table");
  const t4d1 = cli(LAB_T4, "SW1", "cisco", `show mac address-table address ${ciscoMac(Dm)}`);
  const t4d2 = cli(LAB_T4, "SW2", "cisco", `show mac address-table address ${ciscoMac(Dm)}`);
  const t6d2 = cli(LAB_T6, "SW2", "cisco", `show mac address-table address ${ciscoMac(Dm)}`);
  const trace1 = cli(LAB_T6, "SW1", "cisco", `show mac address-table address ${ciscoMac(B)}`);
  const trace2 = cli(LAB_T6, "SW1", "cisco", "show interfaces status");
  const trace3 = cli(LAB_T6, "SW2", "cisco", `show mac address-table address ${ciscoMac(B)}`);
  const trunk2 = cli(LAB_T6, "SW2", "juniper", `show ethernet-switching table interface ${P}`);
  const terseBefore = cli(LAB_T6, "SW1", "juniper", "show interfaces terse");
  const ifDown = cli(LAB_T6, "SW1", "cisco", `show interfaces ${S2.replace("ge-0/0/", "Gi1/0/")}`);
  const loopStatus = cli(LAB_LOOP, "SW1", "cisco", "show interfaces status");
  const loopA1 = cli(LAB_LOOP, "SW1", "cisco", `show mac address-table address ${ciscoMac(A)}`);
  const loopA2 = cli(LAB_LOOP, "SW2", "juniper", "show ethernet-switching table");
  const fixedStatus = cli(LAB_VERIFIED, "SW1", "juniper", "show interfaces terse");
  const fixedA1 = cli(LAB_VERIFIED, "SW1", "cisco", `show mac address-table address ${ciscoMac(A)}`);
  const fixedA2 = cli(LAB_VERIFIED, "SW2", "cisco", `show mac address-table address ${ciscoMac(A)}`);
  const loopLog = cli(LAB_LOOP, "SW2", "cisco", "show logging");

  return (
    <div className="space-y-12">
      {/* ------------------------------------------------------------ Foundation */}
      <GuideSection id="swd-why" eyebrow="Foundation" title="Why multiple switches are needed" tone="ethernet">
        <p>
          One switch runs out of ports, and it sits in one place. Real LANs join switches together — one per wiring closet, floor or rack — so that hosts plugged into <Strong>different</Strong> switches can still exchange frames as if they shared one. Here, HOST-A and HOST-D are on SW1, HOST-B and HOST-C are on SW2, and the two switches are joined by <Mono>{P}</Mono>. A second cable, <Mono>{S2}</Mono>, is plugged in but disabled.
        </p>
        <DiagramFrame caption="The network used everywhere in this lesson: the guided lesson, this guide and the Switching Lab.">
          <TopologyDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "What joining switches gives you", tone: "success", tag: "one LAN", points: ["More ports, in more places", "Any host can reach any other host by MAC", "Still no configuration needed to forward"] },
            { title: "What it does NOT give you", tone: "warning", tag: "common surprise", points: ["One shared brain or one shared table", "Any end-to-end path decision", "Protection against loops (that needs a protocol)"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="swd-independent" eyebrow="Foundation" title="Every bridge learns independently" tone="cyan">
        <DiagramFrame caption="Each switch runs the whole pipeline on every frame it receives — with its own table.">
          <PipelineDiagram />
        </DiagramFrame>
        <Callout tone="cyan" title="The core mental model">
          There is no &quot;the MAC table&quot; of this network. There is <Strong>SW1&apos;s</Strong> table and <Strong>SW2&apos;s</Strong> table. Each is filled only from the source MACs of frames that arrive on that switch&apos;s own ports — so the same MAC can sit on different ports on different switches, and both entries are correct.
        </Callout>
      </GuideSection>

      <GuideSection id="swd-nosync" eyebrow="Foundation" title="MAC tables are not synchronized" tone="violet">
        <p>Switches never send each other their tables. Plain transparent bridging has no protocol for it: every entry on SW2 got there because a frame entered one of SW2&apos;s ports. The lab&apos;s own model, after HOST-A → HOST-B and HOST-B → HOST-A:</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldTable title="SW1 after T2" columns={["MAC", "Port", "From SW1's position"]} rows={fdbRows(LAB_T2, "SW1")} />
          <FieldTable title="SW2 after T2" columns={["MAC", "Port", "From SW2's position"]} rows={fdbRows(LAB_T2, "SW2")} accent="violet" />
        </div>
        <p>Same two MACs, two tables, different ports. Nothing was copied — both switches saw both frames, and each wrote down its own ingress port.</p>
      </GuideSection>

      <GuideSection id="swd-local" eyebrow="Foundation" title="Local vs inter-switch learned MACs" tone="violet">
        <DiagramFrame caption="Entries for hosts on the far switch all point at the inter-switch port.">
          <ViewsDiagram />
        </DiagramFrame>
        <FieldTable
          title="Reading an entry"
          columns={["Entry on…", "Means", "Example (SW1)"]}
          rows={[
            ["an access port", "the host is plugged in right there", "HOST-A → ge-0/0/1"],
            ["the inter-switch port", "the host is somewhere beyond the other switch — this switch can't tell which port over there", `HOST-B → ${P}`],
          ]}
        />
        <p>Several MACs behind one inter-switch port is normal. Several MACs behind an access port means another switch (or a hub) is hiding behind it.</p>
      </GuideSection>

      {/* ------------------------------------------------------------ Learning across switches */}
      <GuideSection id="swd-source" eyebrow="Learning" title="Source learning on multiple switches" tone="warning">
        <KnowledgeCheck question={{ id: "p-src", prompt: `Before reading on: HOST-A's first frame arrives at SW2 on ${P}. What does SW2 write down?`, options: [{ id: "a", label: `HOST-A → ${P}` }, { id: "b", label: "HOST-A → ge-0/0/1 (copied from SW1)" }, { id: "c", label: "Nothing — SW1 already learned it" }], correctId: "a", explanation: "SW2 learns against ITS ingress port. It has no idea which SW1 port HOST-A is on, and doesn't need to." }} />
        <DiagramFrame caption="Learned twice: SW1 on ge-0/0/1, SW2 on the inter-switch link.">
          <FirstFrameDiagram />
        </DiagramFrame>
        <div className="grid gap-3 sm:grid-cols-2">
          <CliPanel {...t1a} caption="SW1 · T1: where is HOST-A?" />
          <CliPanel {...t1b} caption="SW2 · T1: where is HOST-A?" />
        </div>
      </GuideSection>

      <GuideSection id="swd-unknown" eyebrow="Learning" title="Unknown-unicast propagation" tone="warning">
        <StateTransition
          states={[
            { label: "SW1: lookup HOST-B", detail: "no entry → flood ge-0/0/2, ge-0/0/23", tone: "warning" },
            { label: "SW2 receives one copy", detail: `learns HOST-A → ${P}`, tone: "violet" },
            { label: "SW2: lookup HOST-B", detail: "no entry → flood ge-0/0/1, ge-0/0/2", tone: "warning" },
            { label: "Hosts filter", detail: "HOST-B accepts · HOST-C, HOST-D discard", tone: "success" },
          ]}
        />
        <p>An unknown-unicast frame travels as far as the tables are ignorant. SW1&apos;s flood reaches SW2 as an ordinary frame; SW2 does its own lookup and, being equally ignorant, floods again. The destination stays HOST-B&apos;s MAC the whole way.</p>
      </GuideSection>

      <GuideSection id="swd-return" eyebrow="Learning" title="Return-path learning" tone="success">
        <DiagramFrame caption="The reply teaches both switches where HOST-B is — each on its own port.">
          <ReplyDiagram />
        </DiagramFrame>
        <div className="grid gap-3 sm:grid-cols-2">
          <CliPanel {...t2j1} caption="Junos · SW1 after the reply" />
          <CliPanel {...t2j2} caption="Junos · SW2 after the reply" />
        </div>
      </GuideSection>

      <GuideSection id="swd-known" eyebrow="Forwarding" title="Known unicast is several independent decisions" tone="cyan">
        <DiagramFrame caption="No switch decides the whole path. Each picks one of its own ports.">
          <TwoLookupsDiagram />
        </DiagramFrame>
        <p>
          SW1 sends HOST-A&apos;s frame out <Mono>{portOf(LAB_T3, "SW1", "HOST-B")}</Mono> because <Strong>its</Strong> table says so. SW2 receives it and sends it out <Mono>{portOf(LAB_T3, "SW2", "HOST-B")}</Mono> because <Strong>its</Strong> table says so. If either table were wrong, only that switch&apos;s decision would be wrong.
        </p>
      </GuideSection>

      <GuideSection id="swd-localsw" eyebrow="Forwarding" title="Local switching" tone="violet">
        <DiagramFrame caption="HOST-D and HOST-A share SW1, so their traffic never leaves it.">
          <LocalDiagram />
        </DiagramFrame>
        <p>Traffic between two hosts on the same switch stays on that switch once the destination is known. That keeps the inter-switch link free for traffic that actually needs it.</p>
      </GuideSection>

      <GuideSection id="swd-never" eyebrow="Learning" title="Why SW2 does not learn from traffic it never receives" tone="violet">
        <div className="grid gap-3 sm:grid-cols-2">
          <CliPanel {...t4d1} caption="SW1 · T4: HOST-D?" />
          <CliPanel {...t4d2} caption="SW2 · T4: HOST-D?" />
        </div>
        <p>After HOST-D ↔ HOST-A, SW1 has HOST-D on ge-0/0/2 and SW2 has nothing. That is not a fault and not a delay — SW2 simply never saw a frame sourced by HOST-D. Learning happens only where frames go.</p>
      </GuideSection>

      {/* ------------------------------------------------------------ Forwarding decisions */}
      <GuideSection id="swd-partial" eyebrow="Decisions" title="Partial knowledge" tone="warning">
        <DiagramFrame caption="SW2 never received a frame from HOST-D, so its lookup misses; SW1's hits.">
          <PartialDiagram />
        </DiagramFrame>
        <p>Tables fill independently, from whatever traffic happens to cross each switch. At any moment one switch can know a host that another doesn&apos;t. That is the normal state of every multi-switch LAN.</p>
      </GuideSection>

      <GuideSection id="swd-floodfwd" eyebrow="Decisions" title="One switch flooding while another forwards" tone="warning">
        <CompareCards
          items={[
            { title: "SW2 — HOST-C → HOST-D", tone: "warning", tag: "lookup MISS", points: ["No entry for HOST-D", "Floods out ge-0/0/1 and ge-0/0/23", "HOST-B gets a copy and discards it"] },
            { title: "SW1 — the same frame", tone: "success", tag: "lookup HIT", points: ["HOST-D known on ge-0/0/2", "Forwards out ge-0/0/2 only", "HOST-A sees nothing"] },
          ]}
        />
        <p>The frame SW1 receives is not &quot;a flooded frame&quot; — a frame carries no memory of how it was forwarded. It is a unicast to HOST-D&apos;s MAC, and SW1 treats it like any other.</p>
      </GuideSection>

      <GuideSection id="swd-broadcast" eyebrow="Decisions" title="Broadcast propagation across the Layer-2 domain" tone="arp">
        <DiagramFrame caption="Every switch floods a broadcast out every forwarding port except the one it arrived on.">
          <BroadcastDiagram />
        </DiagramFrame>
        <CliPanel {...t6d2} caption="SW2 · T6: HOST-D learned at last — from the broadcast's source" />
        <p>
          HOST-D&apos;s ARP request (<Mono>{BROADCAST_MAC}</Mono>) reached HOST-A, HOST-B and HOST-C once each, and never came back to HOST-D. On the way, SW2 learned HOST-D for the first time — a broadcast still has a normal source MAC.
        </p>
      </GuideSection>

      <GuideSection id="swd-compare" eyebrow="Decisions" title="Comparing the same MAC across SW1 and SW2" tone="cyan">
        <FieldTable title="After T6 — each switch's answer for every host (from the lab's model)" columns={["Host", "SW1 says", "SW2 says"]} rows={compareRows(LAB_T6)} />
        <p>Every host is local on one switch and behind the inter-switch link on the other. Comparing both switches&apos; answers for one MAC is the fastest way to see the path a frame takes — and to spot an entry that doesn&apos;t fit.</p>
      </GuideSection>

      <GuideSection id="swd-frame" eyebrow="The frame" title="Ethernet frame preservation across bridges" tone="ethernet">
        <PacketAnatomy
          title="HOST-A → HOST-B, as it leaves SW2 on ge-0/0/1 (identical to when it left HOST-A)"
          layers={[
            {
              name: "Ethernet II header",
              tone: "ethernet",
              note: "read by SW1 and SW2, changed by neither",
              fields: [
                { name: "Destination MAC", value: B, why: "Looked up by SW1, then again by SW2 — each in its own table.", key: true },
                { name: "Source MAC", value: A, why: "Still HOST-A's MAC. SW1 learned it on ge-0/0/1, SW2 on ge-0/0/23.", key: true },
                { name: "EtherType", value: "0x0800 (IPv4)", why: "Carried through unchanged." },
              ],
            },
            { name: "Payload", tone: "ip", note: "never read by a switch", fields: [{ name: "Carries", value: "IPv4 packet", why: "The IPv4 TTL inside is not touched by switches either." }] },
            { name: "Trailer", tone: "ethernet", fields: [{ name: "FCS", value: "CRC-32", why: "Checked on receive by each switch (store-and-forward); a corrupted frame is dropped, never learned from." }] },
          ]}
        />
        <p>A transparent bridge is called transparent for this reason: hosts can&apos;t tell it is there. The frame HOST-B receives is bit-for-bit the frame HOST-A sent.</p>
      </GuideSection>

      <GuideSection id="swd-ttl" eyebrow="The frame" title="Why Ethernet switching has no IP-style TTL" tone="danger">
        <DiagramFrame caption="Routers drop a looping packet when its TTL reaches 0. Bridges have nothing to count down.">
          <NoTtlDiagram />
        </DiagramFrame>
        <p>The Ethernet header is destination, source and EtherType — no hop count. A switch doesn&apos;t change the frame at all, and it doesn&apos;t read the IPv4 header inside. So nothing at Layer 2 can notice that a frame has been forwarded a thousand times. That is harmless in a loop-free topology — and catastrophic in a looped one.</p>
      </GuideSection>

      {/* ------------------------------------------------------------ Operations */}
      <GuideSection id="swd-cli" eyebrow="Operations" title="Cisco and Junos operational verification" tone="cyan">
        <FieldTable
          title="Every command answers an engineering question — run it on EACH switch"
          columns={["Question", "Cisco IOS", "Junos"]}
          rows={[
            ["What MACs does this switch know?", <Mono key="c">show mac address-table</Mono>, <Mono key="j">show ethernet-switching table</Mono>],
            ["Where did this switch learn one MAC?", <Mono key="c">show mac address-table address H.H.H</Mono>, "read it in the table"],
            ["What is behind one port?", <Mono key="c">show mac address-table interface Gi1/0/23</Mono>, <Mono key="j">show ethernet-switching table interface ge-0/0/23</Mono>],
            ["Which ports are up?", <Mono key="c">show interfaces status</Mono>, <Mono key="j">show interfaces terse</Mono>],
            ["One port in detail", <Mono key="c">show interfaces Gi1/0/24</Mono>, <Mono key="j">show interfaces ge-0/0/24</Mono>],
          ]}
        />
        <Callout tone="cyan" title="Two switches, two answers">
          Each switch&apos;s CLI shows <Strong>that switch&apos;s</Strong> table. Asking SW1 where HOST-B is tells you nothing about SW2&apos;s table. Cisco names the lesson&apos;s ports <Mono>Gi1/0/1</Mono>, <Mono>Gi1/0/2</Mono>, <Mono>Gi1/0/23</Mono>, <Mono>Gi1/0/24</Mono>; Junos and this lesson call them <Mono>ge-0/0/1</Mono>, <Mono>ge-0/0/2</Mono>, <Mono>{P}</Mono>, <Mono>{S2}</Mono>. No VLANs here: Cisco shows VLAN 1, Junos <Mono>default</Mono>.
        </Callout>
        <CliPanel {...trunk2} caption="Junos · SW2 at T6: everything behind its link to SW1" />
      </GuideSection>

      <GuideSection id="swd-trace" eyebrow="Operations" title="Tracing a MAC switch by switch" tone="cyan">
        <FlowSteps
          steps={[
            { title: "Ask the first switch", body: "Where does SW1 have HOST-B? → the port it would forward to.", tone: "cyan" },
            { title: "Find out what is on that port", body: "Its description and link state say whether it's a host or another switch.", tone: "violet" },
            { title: "If it's a switch, go there and ask again", body: "Repeat on SW2 until the MAC is on an access port.", tone: "warning" },
            { title: "Confirm at the end", body: "The final access port should be where the host is actually plugged in.", tone: "success" },
          ]}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <CliPanel {...trace1} caption="1 · SW1: HOST-B is behind Gi1/0/23" />
          <CliPanel {...trace3} caption="3 · SW2: HOST-B is on Gi1/0/1 — an access port" />
        </div>
        <CliPanel {...trace2} caption="2 · SW1: Gi1/0/23 is the link to SW2" />
      </GuideSection>

      <GuideSection id="swd-links" eyebrow="Operations" title="Interface and link-state verification" tone="cyan">
        <div className="grid gap-3 sm:grid-cols-2">
          <CliPanel {...terseBefore} caption={`Junos · SW1: ${S2} down/down (disabled)`} />
          <CliPanel {...ifDown} caption={`Cisco · SW1: ${S2} in detail`} />
        </div>
        <p>
          Link state tells you which paths <Strong>can</Strong> forward. Before the incident <Mono>{S2}</Mono> is administratively down, so exactly one path joins the switches. When counting paths between two switches, count the links that are up and forwarding — a cabled but disabled link doesn&apos;t count, an enabled one does.
        </p>
      </GuideSection>

      {/* ------------------------------------------------------------ Troubleshooting */}
      <GuideSection id="swd-workflow" eyebrow="Troubleshooting" title="Troubleshooting workflow" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Symptom — what exactly fails?", look: "HOST-D can't reach HOST-A, although both are on SW1. Reproduce it before changing anything." },
            { question: "Observation — what else is happening?", look: "Duplicate broadcasts since a cabling change. No device reports an error." },
            { question: "Evidence — what does the state say, on EACH switch?", look: "Link state of both SW1↔SW2 links · where SW1 and SW2 have HOST-A · where HOST-A is really plugged in · copies per host." },
            { question: "Hypothesis — what single cause fits ALL the evidence?", look: "Not 'the tables are corrupted' and not 'flapping' — what makes both of those happen?" },
            { question: "Test — what observation proves it?", look: "Count the forwarding paths between the switches; compare where the tables put HOST-A with where HOST-A is." },
            { question: "Root cause — why did it happen?", look: "Explain the chain from the change to the symptom, step by step." },
            { question: "Repair — the smallest change that removes the cause", look: "Change the topology, not the symptoms." },
            { question: "Verify — prove it with traffic and state", look: "One copy per host for a new broadcast; HOST-A back on ge-0/0/1; known unicast at both switches." },
          ]}
        />
      </GuideSection>

      <GuideSection id="swd-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "A", title: "Duplicate frames at hosts", tone: "danger", points: ["One broadcast received two or more times", "Copies arriving on more than one path", "→ suspect a Layer-2 loop"] },
            { tag: "B", title: "A MAC keeps changing ports", tone: "danger", points: ["The same source MAC learned on several ports in a row", "The host hasn't moved", "→ looped copies (or a real duplicate MAC)"] },
            { tag: "C", title: "Local traffic sent across the link", tone: "warning", points: ["Two hosts on one switch can't talk", "That switch has the destination on an inter-switch port", "→ its table was misled — find what misled it"] },
            { tag: "D", title: "Flooded at one switch, forwarded at the next", tone: "success", points: ["Partial knowledge", "Normal: tables fill from the traffic they see", "→ not a fault"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="swd-flap" eyebrow="Troubleshooting" title="MAC flapping" tone="warning">
        <DiagramFrame caption="One MAC, several ports in a row — without the host ever moving.">
          <FlapDiagram />
        </DiagramFrame>
        {LOOP_MOVES.length > 0 && (
          <FieldTable
            title={`Moves the lab's model recorded during HOST-A's looping broadcast (first ${SN_WAVES} hops drawn)`}
            columns={["Switch", "MAC", "From", "To"]}
            rows={LOOP_MOVES.slice(0, 10).map((m) => [m.sw, "HOST-A", m.from, m.to])}
            accent="warning"
          />
        )}
        <CliPanel {...loopLog} caption="SW2 logs it: the same MAC flapping between its two uplinks" />
        <p>
          Flapping is a <Strong>symptom</Strong>. Source learning is doing exactly its job: a frame with HOST-A&apos;s source MAC arrived on a new port, so the entry moved. The question is <em>why</em> HOST-A&apos;s frames keep arriving on different ports — copies looping, or two devices sharing one MAC (the lab has a ticket for each). Cisco logs <Mono>%SW_MATM-4-MACFLAP_NOTIF</Mono>; on Junos, read <Mono>show ethernet-switching mac-learning-log</Mono>.
        </p>
      </GuideSection>

      <GuideSection id="swd-incident" eyebrow="Troubleshooting" title="The Ethernet loop incident" tone="danger">
        <DiagramFrame caption={`${S2} enabled on both switches, no loop prevention: one broadcast becomes copies that keep circling.`}>
          <LoopDiagram />
        </DiagramFrame>
        {LOOP_COPIES && (
          <p>
            In the lab&apos;s model, HOST-A&apos;s one broadcast reached HOST-B {LOOP_COPIES["HOST-B"]}×, HOST-C {LOOP_COPIES["HOST-C"]}×, HOST-D {LOOP_COPIES["HOST-D"]}× and HOST-A itself {LOOP_COPIES["HOST-A"]}× in the first {SN_WAVES} hops — with {snCirculating(LAB_LOOP)} copies still circulating when the drawing paused.
          </p>
        )}
        <p>The evidence you will gather in the lab, produced by the lab&apos;s model at the moment of the incident:</p>
        <CliPanel {...loopStatus} caption="1 · SW1: both links to SW2 are connected" />
        <div className="grid gap-3 sm:grid-cols-2">
          <CliPanel {...loopA1} caption="2 · SW1: HOST-A is NOT on Gi1/0/1" />
          <CliPanel {...loopA2} caption="3 · SW2 (Junos): HOST-A behind ge-0/0/24" />
        </div>
        <Callout tone="danger" title="Root cause">
          Two forwarding SW1↔SW2 links and no loop prevention → every flood leaves on both and returns on the other → no TTL, so copies circulate → each copy carries HOST-A&apos;s MAC into new ports → SW1&apos;s entry for HOST-A ends up on <Mono>{portOf(LAB_LOOP, "SW1", "HOST-A")}</Mono> → HOST-D&apos;s frames for HOST-A are sent toward SW2, which filters them (it has HOST-A behind the same port they arrived on).
        </Callout>
        <DiagramFrame caption={`The repair: ${S2} disabled on both switches. One path, one copy per host.`}>
          <RepairDiagram />
        </DiagramFrame>
        {VERIFY_COPIES && (
          <p>
            Verified in the lab&apos;s model: a new broadcast from HOST-A reaches HOST-B {VERIFY_COPIES["HOST-B"]}×, HOST-C {VERIFY_COPIES["HOST-C"]}×, HOST-D {VERIFY_COPIES["HOST-D"]}× — and nothing circulates.
          </p>
        )}
        <CliPanel {...fixedStatus} caption={`After the repair · SW1 (Junos): ${S2} down`} />
        <div className="grid gap-3 sm:grid-cols-2">
          <CliPanel {...fixedA1} caption="SW1: HOST-A back on Gi1/0/1" />
          <CliPanel {...fixedA2} caption="SW2: HOST-A behind Gi1/0/23" />
        </div>
        <LabBridge label="Troubleshoot the loop in the Switching Lab">Enable the second link yourself, watch the broadcast circulate, gather the evidence on both switches&apos; CLIs and fix it.</LabBridge>
      </GuideSection>

      <GuideSection id="swd-forever" eyebrow="Troubleshooting" title="Why the loop does not stop by itself" tone="danger">
        <FlowSteps
          steps={[
            { title: "No TTL", body: "Nothing in the frame changes between passes, so no switch can tell a copy has looped.", tone: "danger" },
            { title: "Flooding is unconditional", body: "A broadcast is flooded every time it arrives — including out the other inter-switch link.", tone: "danger" },
            { title: "Learning makes it worse, not better", body: "Each pass moves the source's entry again; clearing tables just restarts the same relearning.", tone: "warning" },
            { title: "New floods add copies", body: "Every new broadcast or unknown-unicast frame joins the loop. Links and CPUs saturate: a broadcast storm.", tone: "warning" },
          ]}
        />
        <Callout tone="danger" title="About the lab's drawing">
          The lab draws {SN_WAVES} hops per run and keeps the remaining copies in flight: they continue at your next action, and the counters keep climbing. The pause is for clarity only — in a real network those copies keep looping, hundreds of thousands of laps per second, until a link is shut down or a loop-prevention protocol blocks one.
        </Callout>
      </GuideSection>

      {/* ------------------------------------------------------------ Beyond this lesson */}
      <GuideSection id="swd-stp" eyebrow="Preview" title="Loop prevention as a preview of STP" tone="success">
        <DiagramFrame caption="Concept only: one link forwards, the redundant one waits.">
          <PreventionDiagram />
        </DiagramFrame>
        <p>
          Redundant links are valuable — a single cable is a single point of failure. The Spanning Tree Protocol family lets you keep them: switches exchange control frames, agree on a loop-free set of links, and hold the rest in a non-forwarding state until they are needed. How it elects and blocks is its own lesson. <Strong>STP is not running in this lab</Strong> — which is exactly why enabling <Mono>{S2}</Mono> created a loop, and why the repair was to disable it by hand.
        </p>
      </GuideSection>

      <GuideSection id="swd-domains" eyebrow="Scope" title="Collision vs broadcast domains" tone="arp">
        <DiagramFrame caption="Full-duplex switched Ethernet: every link is its own collision domain; the whole LAN is one broadcast domain.">
          <DomainsDiagram />
        </DiagramFrame>
        <p>Adding SW2 enlarged the broadcast domain: HOST-D&apos;s broadcast reached hosts on both switches. That is also why a loop anywhere in it affects every host in it.</p>
      </GuideSection>

      {/* ------------------------------------------------------------ Master it */}
      <GuideSection id="swd-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "Switches share one MAC table.", correction: "Each bridge has its own table, filled only from frames on its own ports. SW1 and SW2 disagree about ports for every host — correctly." },
            { myth: "If SW1 knows HOST-D, SW2 must know it too.", correction: "SW2 learns HOST-D only from a frame HOST-D sends that reaches SW2. Local traffic on SW1 never does." },
            { myth: "Flooding on SW2 means SW1 must also flood.", correction: "Each switch does its own lookup. SW2 flooded HOST-C → HOST-D; SW1 forwarded the same frame out ge-0/0/2 only." },
            { myth: "The frame gets a new source MAC when another switch forwards it.", correction: <>Bridges forward frames unchanged. HOST-B sees source <Mono>{A}</Mono> — that is why SW2 can learn HOST-A at all.</> },
            { myth: "Ethernet bridges decrement TTL.", correction: "There is no TTL in the Ethernet header, and switches don't touch the IPv4 TTL inside. Nothing counts down at Layer 2." },
            { myth: "A loop naturally stops after a few passes.", correction: `It never stops by itself. The lab only stops DRAWING after ${SN_WAVES} hops — the copies stay in flight.` },
            { myth: "MAC flapping itself is the root cause.", correction: "Flapping is a symptom of looped copies carrying one source MAC into several ports. Fix the loop and the entry settles." },
            { myth: "STP is already operating in this lab.", correction: "No loop-prevention protocol runs here. That is why two forwarding links between SW1 and SW2 formed a loop." },
          ]}
        />
      </GuideSection>

      <GuideSection id="swd-quiz" eyebrow="Master it" title="Knowledge check" tone="success">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="swd-explain" eyebrow="Master it" title="Can you explain it?" tone="success">
        <ExplainIt
          items={[
            { q: "Why does SW2 have HOST-A on ge-0/0/23 while SW1 has it on ge-0/0/1?", a: "Each switch learns a source MAC against the port the frame arrived on. HOST-A's frames enter SW1 on ge-0/0/1 and enter SW2 on its link to SW1. Both entries are correct from where each switch stands." },
            { q: "Why did SW2 flood HOST-C → HOST-D while SW1 forwarded it?", a: "SW2 had never received a frame from HOST-D, so its lookup missed. SW1 had learned HOST-D from HOST-D's own frames on ge-0/0/2, so its lookup hit. Two switches, two tables, two independent decisions." },
            { q: "Why does enabling a second link between the switches break the LAN?", a: "A flood leaves on every forwarding port but the ingress, so each copy goes out both links and returns on the other. Ethernet has no TTL, so the copies circulate forever; looped copies move MAC entries (flapping), which misdirects unicast. Without loop prevention there must be exactly one forwarding path." },
          ]}
        />
      </GuideSection>

      <GuideSection id="swd-practice" eyebrow="Practice" title="Practice in the Switching Lab" tone="cyan">
        <ChecklistCard
          tone="cyan"
          title="In the lab you will"
          mark="→"
          items={[
            "Predict, then watch both switches learn and flood the first frame",
            "Compare the same MAC on SW1 and SW2 — on both switches' Cisco and Junos CLIs",
            "Keep traffic local and prove SW2 never learned HOST-D",
            "See one switch flood while the other forwards the same frame",
            "Enable the second link, predict, and watch a broadcast circulate",
            "Troubleshoot the loop from evidence, fix it — and prove the fix with traffic and state",
          ]}
        />
        <LabBridge label="Open the Switching Lab">Same network, your own copy of it. Nothing you do there changes your lesson progress.</LabBridge>
      </GuideSection>
    </div>
  );
}

