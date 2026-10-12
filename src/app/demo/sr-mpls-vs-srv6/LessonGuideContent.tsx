import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import { DHeaderColumn, Srv6Topology, type Srv6Link, type Srv6Pos } from "@/components/lesson/Srv6GuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { CUST_A_DT4, GLOBAL_DT4, HEADER_MPLS_BYTES, HEADER_SEGMENTS, HEADER_SRV6_BYTES, MPLS_TE_STACK, REPAIR_SOURCE, SHARED_REPAIR, SRV6_TE_INITIAL_SL, SRV6_TE_PROGRAM, SRV6_TE_SRH, TRANSPORT_LABEL, TRANSPORT_SOURCE, VPN_LABEL_PE2 } from "./guideModel";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import { createDNet, dApply, dTicket, dTicketState, lossText, type DAction, type DR, type DRtr, type DState, type DTicketId } from "@/lib/sim-engine/scenarios/dpNet";
import { dpSets, dpStaticApi } from "./dp-lab/dpCli";

export const SRCMP_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "ml-mission", label: "What this lesson teaches" },
  { id: "ml-network", label: "The network of this lesson" },
  { id: "ml-ideas", label: "Three ideas you need" },
  { id: "ml-watch", label: "What you will watch" },
  { id: "ml-ids", label: "Labels and locators" },
  { id: "ml-mpls", label: "One packet over SR-MPLS" },
  { id: "ml-srv6", label: "The same packet over SRv6" },
  { id: "ml-te", label: "Explicit TE in both" },
  { id: "ml-transit", label: "What transit routers must know" },
  { id: "ml-tilfa", label: "One repair, two encodings" },
  { id: "ml-bytes", label: "The header budget" },
  { id: "ml-working", label: "What working looks like" },
  { id: "ml-incident", label: "The migration incident" },
  { id: "ml-investigate", label: "Investigation" },
  { id: "ml-repair", label: "Repair, fresh test, proof" },
  { id: "ml-other", label: "Other ways it breaks" },
  { id: "ml-choose", label: "Trade-offs, not a winner" },
  { id: "ml-model", label: "Mental model" },
  { id: "ml-glossary", label: "Glossary" },
  { id: "ml-recap", label: "Recap" },
  { id: "ml-practice", label: "Practice it" },
];

/** Real IOS XR output and traffic results on this page come from the SR-MPLS vs SRv6 Lab (dpNet.ts). */
const NL = String.fromCharCode(10);
const D0: DState = createDNet(0);
const run = (s: DState, ...a: DAction[]) => a.reduce((acc, x) => dApply(acc, x), s);
export const dpSet = (text: string, dev: DR, f: (c: DRtr) => void): DAction => ({ type: "set", text, changes: [{ dev, f }] });
export const dpTicketRun = (id: DTicketId) => dTicket(id).repro.reduce((acc, a) => dApply(acc, a), dTicketState(id, 1));
export const TO_SRV6 = dpSet("PE2: VRF CUST-A over SRv6", "PE2", (c) => void (c.vrfSrv6 = true));
const P100 = { type: "ping", size: 100 } as const;
const D100 = { type: "drill", size: 100 } as const;
const PM = run(D0, P100);
const P6 = run(D0, TO_SRV6, P100);
const DM = run(D0, D100);
const D6 = run(D0, TO_SRV6, D100);
const NOP2 = dpSet("P2: no segment-routing mpls", "P2", (c) => void (c.mpls = false));
const P2M = run(D0, NOP2, P100);
const P26 = run(D0, NOP2, TO_SRV6, P100);
const INC = dpTicketRun("locator");
const INC_FIX = run(INC, dpSet("fix", "PE2", (c) => void (c.isisLoc = true)), P100);
export function dpCli(s: DState, r: DR, command: string) {
  return runGuideCli(dpSets(dpStaticApi(s, r), r).cisco, command);
}
export function dpOnly(s: DState, r: DR, command: string, match: RegExp, keep = 0) {
  const x = dpCli(s, r, command);
  return { ...x, output: pickLines(x.output, match, keep) };
}
/** Every line matching `match`, each with the `next` lines that follow it. */
export function dpWith(s: DState, r: DR, command: string, match: RegExp, next = 1) {
  const x = dpCli(s, r, command);
  const lines = x.output.split(NL);
  return { ...x, output: lines.filter((_, i) => lines.slice(Math.max(0, i - next), i + 1).some((l) => match.test(l))).join(NL) };
}
/** Lines from the first match of `from` up to (not including) the first later match of `stop`. */
export function dpBlock(s: DState, r: DR, command: string, from: RegExp, stop?: RegExp) {
  const x = dpCli(s, r, command);
  const lines = x.output.split(NL);
  const i = lines.findIndex((l) => from.test(l));
  if (i < 0) return x;
  let j = stop ? lines.findIndex((l, k) => k > i && stop.test(l)) : -1;
  if (j < 0) j = lines.length;
  return { ...x, output: lines.slice(i, j).join(NL) };
}
/** One test, as the lab reports it. */
export function DpResult({ s, title, i }: { s: DState; title: string; i?: number }) {
  const t = s.tests[i ?? s.tests.length - 1];
  return (
    <Callout tone={t.walk.ok ? "success" : "danger"} title={title} icon={t.walk.ok ? "✓" : "!"}>
      {t.cut ? "P1–P2 cut · " : ""}CE1 → CE2, {t.size} bytes over {t.enc === "mpls" ? "SR-MPLS" : "SRv6"}: {t.walk.ok ? `delivered via ${t.walk.path.join(" → ")}` : t.walk.why} · {t.walk.overhead} bytes of encapsulation{t.walk.peakOverhead > t.walk.overhead ? `, ${t.walk.peakOverhead} during the repair` : ""}{t.cut ? ` · lost: ${lossText(t.lossMs)}` : ""}
    </Callout>
  );
}
/** The header at each hop, from the lab's walk. */
export function DpHops({ s, title }: { s: DState; title: string }) {
  const t = s.tests[s.tests.length - 1];
  return <FieldTable title={title} accent={t.enc === "mpls" ? "mpls" : "ip"} columns={["Link", "Header", "Bytes"]} rows={t.walk.hops.filter((h) => h.to && h.at !== h.to).map((h) => [`${h.at} → ${h.to}`, <Mono key="h">{h.hdr}</Mono>, String(h.bytes)])} />;
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the SR-MPLS vs SRv6 Lab" onPractice={openLab}>
      The network of this lesson on IOS XR with both data planes: carry CUST-A over labels or an SRv6 SID, compare the headers from the live network, switch SR-MPLS off in transit, drill the P1–P2 cut in both planes, IOS XR consoles — your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const POS: Srv6Pos = {
  CE1: [40, 110],
  PE1: [130, 110],
  P1: [225, 110],
  P2: [400, 40],
  PE2: [510, 90],
  P3: [285, 190],
  P4: [400, 190],
  CE2: [600, 110],
};
const LINKS: Srv6Link[] = [
  { a: "CE1", b: "PE1" },
  { a: "PE1", b: "P1" },
  { a: "P1", b: "P2" },
  { a: "P2", b: "PE2" },
  { a: "P1", b: "P3" },
  { a: "P3", b: "P4" },
  { a: "P4", b: "P2" },
  { a: "P4", b: "PE2" },
  { a: "PE2", b: "CE2" },
];

function TopologyDiagram() {
  return (
    <DiagramSvg h={240} label="Shared topology: CE1, PE1, P1, P2, PE2, CE2 on the primary path; P3 and P4 form the alternate core; both architectures use exactly the same routers and links">
      <Srv6Topology pos={POS} links={LINKS} sub={{ PE1: "headend", P1: "PLR", PE2: "egress" }} accent={{ CE1: D.faint, CE2: D.faint, PE1: D.ip, PE2: D.success, P1: D.warning }} boxW={62} />
      <text x={320} y={232} textAnchor="middle" fill={D.muted} fontSize={10}>
        same routers, same links, same IGP metrics for SR-MPLS and SRv6 — only the packet encoding differs
      </text>
    </DiagramSvg>
  );
}

function TransportDiagram() {
  return (
    <DiagramSvg h={200} label={`Shortest-path transport: SR-MPLS pushes Node-SID label ${TRANSPORT_LABEL} above customer IPv4; SRv6 adds an outer IPv6 header with destination ${GLOBAL_DT4}, PE2's global-table End.DT4, and no SRH`}>
      <text x={160} y={20} textAnchor="middle" fill={D.mpls} fontSize={12} fontWeight={700}>
        SR-MPLS
      </text>
      <DStack x={160} y={32} w={150} labels={[{ text: `${TRANSPORT_LABEL} S1`, color: D.mpls, tag: "PE2" }]} payload="customer IPv4" caption="Node-SID(PE2), bottom of stack" />
      <text x={470} y={20} textAnchor="middle" fill={D.ip} fontSize={12} fontWeight={700}>
        SRv6
      </text>
      <DHeaderColumn
        x={470}
        y={32}
        w={250}
        rows={[
          { text: `SA ${TRANSPORT_SOURCE} (PE1)`, color: D.ip },
          { text: `DA ${GLOBAL_DT4}`, color: D.ip, strong: true, tag: "DA" },
          { text: "customer IPv4", color: D.eth },
        ]}
        caption="PE2 End.DT4 (global table) · no SRH"
      />
    </DiagramSvg>
  );
}

function TeDiagram() {
  return (
    <DiagramSvg h={230} label={`Explicit TE: SR-MPLS stack ${MPLS_TE_STACK.map((l) => `${l.label} S${l.s}`).join(", ")}; SRv6 destination ${SRV6_TE_PROGRAM[0]?.sid} with SRH Segments Left ${SRV6_TE_INITIAL_SL}, list ${SRV6_TE_SRH.map((e) => `[${e.index}] ${e.name}`).join(", ")}`}>
      <text x={160} y={20} textAnchor="middle" fill={D.mpls} fontSize={12} fontWeight={700}>
        SR-MPLS · {MPLS_TE_STACK.length} labels
      </text>
      <DStack x={160} y={32} w={150} labels={MPLS_TE_STACK.map((l) => ({ text: `${l.label} S${l.s}`, color: D.mpls }))} payload="customer IPv4" caption={MPLS_TE_STACK.map((l) => l.meaning).join(" · ")} />
      <text x={470} y={20} textAnchor="middle" fill={D.ip} fontSize={12} fontWeight={700}>
        SRv6 · {SRV6_TE_PROGRAM.length} SIDs
      </text>
      <DHeaderColumn
        x={470}
        y={32}
        w={270}
        rows={[
          { text: `DA ${SRV6_TE_PROGRAM[0]?.sid}`, color: D.ip, strong: true, tag: "DA" },
          { text: `SRH · SL ${SRV6_TE_INITIAL_SL} · LE ${SRV6_TE_SRH.length - 1}`, color: D.violet, tag: "SRH" },
          ...SRV6_TE_SRH.map((e) => ({ text: `[${e.index}] ${e.name}`, color: D.violet })),
          { text: "customer IPv4", color: D.eth },
        ]}
      />
    </DiagramSvg>
  );
}

function VpnDiagram() {
  return (
    <DiagramSvg h={200} label={`L3VPN: SR-MPLS carries transport label ${TRANSPORT_LABEL} over VPN label ${VPN_LABEL_PE2}; SRv6 carries one outer IPv6 header whose destination is the CUST-A Service SID ${CUST_A_DT4}`}>
      <text x={160} y={20} textAnchor="middle" fill={D.mpls} fontSize={12} fontWeight={700}>
        SR-MPLS L3VPN
      </text>
      <DStack
        x={160}
        y={32}
        w={150}
        labels={[
          { text: `${TRANSPORT_LABEL} S0`, color: D.mpls, tag: "TRANSPORT" },
          { text: `${VPN_LABEL_PE2} S1`, color: D.bgp, tag: "VPN" },
        ]}
        payload="customer IPv4"
        caption="transport over VPN label"
      />
      <text x={470} y={20} textAnchor="middle" fill={D.ip} fontSize={12} fontWeight={700}>
        SRv6 L3VPN
      </text>
      <DHeaderColumn
        x={470}
        y={32}
        w={250}
        rows={[
          { text: `DA ${CUST_A_DT4}`, color: D.bgp, strong: true, tag: "DA" },
          { text: "customer IPv4", color: D.eth },
        ]}
        caption="Service SID: End.DT4 in VRF CUST-A"
      />
      <text x={320} y={186} textAnchor="middle" fill={D.muted} fontSize={10}>
        {CUST_A_DT4} (VRF CUST-A) is not {GLOBAL_DT4} (global table)
      </text>
    </DiagramSvg>
  );
}

function TiLfaDiagram() {
  return (
    <DiagramSvg h={230} label={`One TI-LFA computation: repair node ${SHARED_REPAIR.repairNode}, merge ${SHARED_REPAIR.mergeTarget}, outgoing interface P1 to ${SHARED_REPAIR.oif}. SR-MPLS pushes ${SHARED_REPAIR.mplsLabels.join(", ")} above ${TRANSPORT_LABEL}; SRv6 adds a repair outer from P1 to ${SHARED_REPAIR.srv6Sid} around the PE1 transport outer`}>
      <text x={320} y={18} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
        shared result: OIF P1→{SHARED_REPAIR.oif} · repair {SHARED_REPAIR.repairNode}→{SHARED_REPAIR.mergeTarget}
      </text>
      <DStack
        x={160}
        y={40}
        w={150}
        labels={[...SHARED_REPAIR.mplsLabels.map((v) => ({ text: `${v} S0`, color: D.warning, tag: "REPAIR" })), { text: `${TRANSPORT_LABEL} S1`, color: D.mpls, tag: "TRANSPORT" }]}
        payload="customer IPv4"
        caption="repair labels above the transport label"
      />
      <DHeaderColumn
        x={470}
        y={40}
        w={280}
        rows={[
          { text: `SA ${REPAIR_SOURCE} (P1)`, color: D.warning, tag: "REPAIR" },
          { text: `DA ${SHARED_REPAIR.srv6Sid} · no SRH`, color: D.warning, strong: true },
          { text: `SA ${TRANSPORT_SOURCE} (PE1)`, color: D.ip, tag: "TRANSPORT" },
          { text: `DA ${GLOBAL_DT4}`, color: D.ip },
          { text: "customer IPv4", color: D.eth },
        ]}
      />
    </DiagramSvg>
  );
}

function HeaderDiagram() {
  const max = HEADER_SRV6_BYTES;
  const bar = (y: number, label: string, bytes: number, color: string) => (
    <g>
      <text x={24} y={y + 17} fill={D.text} fontSize={11} fontWeight={700}>
        {label}
      </text>
      <rect x={230} y={y} width={(bytes / max) * 330} height={26} rx={6} fill={color} fillOpacity={0.2} stroke={color} strokeOpacity={0.8} />
      <text x={236 + (bytes / max) * 330} y={y + 17} fill={color} fontSize={10.5} fontWeight={700} fontFamily="monospace">
        {bytes} B
      </text>
    </g>
  );
  return (
    <DiagramSvg h={140} label={`${HEADER_SEGMENTS}-segment program: SR-MPLS instruction storage ${HEADER_MPLS_BYTES} bytes, uncompressed SRv6 ${HEADER_SRV6_BYTES} bytes`}>
      {bar(24, `SR-MPLS (${HEADER_SEGMENTS} labels)`, HEADER_MPLS_BYTES, D.mpls)}
      {bar(62, `SRv6 (${HEADER_SEGMENTS} SIDs)`, HEADER_SRV6_BYTES, D.ip)}
      <text x={320} y={124} textAnchor="middle" fill={D.muted} fontSize={10}>
        instruction storage only · the lesson&apos;s CSID lab then compresses the SRv6 side
      </text>
    </DiagramSvg>
  );
}

function LadderDiagram() {
  const steps = ["Physical / IGP adjacency", "Transport reachability", "Control plane (BGP route)", "Service import (RT / VRF)", "Service data plane"];
  return (
    <DiagramSvg h={220} label="Troubleshooting ladder shared by both architectures: physical and IGP, transport reachability, BGP route, service import, service data plane">
      {steps.map((s, i) => (
        <g key={s}>
          <rect x={150} y={14 + i * 38} width={340} height={30} rx={8} fill={D.cyan} fillOpacity={0.08} stroke={D.cyan} strokeOpacity={0.6} />
          <text x={320} y={34 + i * 38} textAnchor="middle" fill={D.text} fontSize={11}>
            {i + 1}. {s}
          </text>
          {i < steps.length - 1 && <DArrow x1={505} y1={29 + i * 38} x2={505} y2={63 + i * 38} color={D.faint} width={1.4} />}
        </g>
      ))}
      <text x={320} y={210} textAnchor="middle" fill={D.muted} fontSize={10}>
        same ladder for both — what you inspect at each rung differs
      </text>
    </DiagramSvg>
  );
}

export function SrMplsVsSrv6LessonGuideContent() {
  const wm = PM.tests[0].walk;
  const w6 = P6.tests[0].walk;
  const dm = DM.tests[0].walk;
  const d6 = D6.tests[0].walk;
  const rp = D0.view.repair;
  return (
    <div className="space-y-12">
      <GuideSection id="ml-mission" eyebrow="This lesson" title="What this lesson teaches" tone="ip">
        <p>
          You have now met Segment Routing twice: with MPLS labels and with IPv6 addresses. Both put the path into the packet, both are computed by the same IS-IS, both carry VPNs and both repair failures with TI-LFA. This lesson answers: <b className="text-pv-text">what really differs between SR-MPLS and SRv6 — and what does that change for the engineer who runs them?</b>
        </p>
        <p>You will run both on one network, send the same customer packet through each, compare the headers byte by byte, see which routers must understand each plane, protect the same link in both — and then work the guided incident, where a VPN migrated to SRv6 stops while SR-MPLS had been working all along.</p>
        <ChecklistCard tone="violet" title="By the end of this lesson you can" mark="→" items={["explain what SR-MPLS and SRv6 share (the architecture, the IGP, the paths) and what differs (the encoding)", "read a prefix-SID label and an SRv6 locator and SID", "follow one VPN packet through each plane, hop by hop", "say what a transit router needs in each plane", "compare a TI-LFA repair in both encodings and its byte cost", "find, fix and prove a fault that hits only one plane"]} />
      </GuideSection>

      <GuideSection id="ml-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="The data-plane topology. In the guided lesson a route reflector exchanges BGP routes only and is never a packet hop.">
          <TopologyDiagram />
        </DiagramFrame>
        <p>
          PE1, P1, P2, P3, P4 and PE2 run IS-IS. The primary path PE1 → P1 → P2 → PE2 costs 30; P3 and P4 form the alternate core (P4–P2 metric 50, P4–PE2 metric 70). Customer VPN CUST-A connects site 1 (CE1, <Mono>10.10.1.0/24</Mono>) to site 2 (CE2, <Mono>10.20.1.0/24</Mono>). <b className="text-pv-text">Every router runs both data planes at once</b> — the realistic situation during a migration.
        </p>
        <Callout tone="cyan" title="The lesson and the lab" icon="i">
          The guided lesson solves one brief twice — transport, explicit TE, L3VPN, TI-LFA, header efficiency — and walks the incident. The lab runs the same network on IOS XR with the same numbers: PE2&apos;s Node SID <Mono>{TRANSPORT_LABEL}</Mono>, VPN label <Mono>{VPN_LABEL_PE2}</Mono>, CUST-A&apos;s End.DT4 <Mono>{CUST_A_DT4}</Mono>, TI-LFA repair through P4 to P2. Outputs on this page come from the lab.
        </Callout>
      </GuideSection>

      <GuideSection id="ml-ideas" eyebrow="This lesson" title="Three ideas you need" tone="violet">
        <CompareCards
          items={[
            { title: "Same architecture", tone: "violet", tag: "RFC 8402", points: ["segments, IGP-distributed", "same shortest paths, same TI-LFA math"] },
            { title: "Two encodings", tone: "mpls", tag: "label vs address", points: ["SR-MPLS: 4-byte labels, popped hop by hop", "SRv6: 128-bit SIDs in IPv6 headers"] },
            { title: "Separate reachability", tone: "ip", tag: "per plane", points: ["labels need prefix-SIDs everywhere", "SIDs need a route to the owner's locator"] },
            { title: "The egress picks", tone: "success", tag: "for a VPN", points: ["VPN label or SRv6 service SID", "the ingress follows what it receives"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="ml-watch" eyebrow="This lesson" title="What you will watch" tone="cyan">
        <TroubleshootingFlow
          steps={[
            { question: "CUST-A over SR-MPLS", look: `PE1 pushes ${wm.hops[1].hdr} — ${wm.overhead} bytes` },
            { question: "CUST-A over SRv6", look: `PE1 sends DA ${w6.hops[1].hdr.replace("DA ", "")} — ${w6.overhead} bytes` },
            { question: "P2 loses SR-MPLS", look: "SR-MPLS drops, SRv6 does not notice" },
            { question: "P1–P2 fails", look: `both planes repair via ${rp.path.join(" → ")}` },
            { question: "The migration incident", look: "SRv6 stops; SR-MPLS never depended on what broke" },
          ]}
        />
      </GuideSection>

      <GuideSection id="ml-ids" eyebrow="Identifiers" title="Labels and locators" tone="mpls">
        <p>
          <b className="text-pv-text">SR-MPLS.</b> Each router&apos;s loopback carries a <b className="text-pv-text">prefix-SID index</b> (PE2: 6). Every router adds it to the same SRGB base (16000), so everyone programs label <Mono>{TRANSPORT_LABEL}</Mono> for PE2. Adjacencies get <b className="text-pv-text">Adj-SIDs</b>, local to their router.
        </p>
        <CliPanel run={dpCli(D0, "P1", "show isis segment-routing label table")} caption="IOS XR · P1 — one label per loopback, SRGB 16000 + index" />
        <p>
          <b className="text-pv-text">SRv6.</b> Each router owns a <b className="text-pv-text">locator</b> — PE2&apos;s is <Mono>2001:db8:100:2::/64</Mono> — and its SIDs are addresses inside it: the locator part says <i>where</i>, the function part says <i>what</i>. IS-IS advertises the locator like any IPv6 prefix.
        </p>
        <CliPanel run={dpCli(D0, "P4", "show segment-routing srv6 sid")} caption="IOS XR · P4 — its End SID and one End.X per adjacency, all inside 2001:db8:110:14::/64" />
        <DiagramFrame caption="The guided lesson's first phase, plain transport: one Node SID label, or one outer IPv6 header to PE2's global-table End.DT4.">
          <TransportDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ml-mpls" eyebrow="Healthy · SR-MPLS" title="One packet over SR-MPLS" tone="mpls">
        <DiagramFrame caption="The VPN on the wire in both planes — the same service, two encodings.">
          <VpnDiagram />
        </DiagramFrame>
        <p>
          PE2 allocates VPN label <Mono>{VPN_LABEL_PE2}</Mono> for CUST-A and advertises it in BGP with its loopback as next hop. PE1 pushes it, and above it PE2&apos;s Node SID <Mono>{TRANSPORT_LABEL}</Mono>. P1 looks only at the top label and swaps it (same label — the same index in the same SRGB). P2 is the penultimate hop and pops it. PE2 receives the VPN label alone, pops it and looks up CUST-A.
        </p>
        <CliPanel run={dpOnly(D0, "PE1", "show cef vrf CUST-A 10.20.1.10", /via|labels imposed/)} caption="IOS XR · PE1 — transport label over VPN label" />
        <CliPanel run={dpCli(D0, "P2", "show mpls forwarding labels 16006")} caption="IOS XR · P2 — 16006: Pop (PHP) toward PE2" />
        <DpHops s={PM} title="The lab: the label stack on each link" />
        <DpResult s={PM} title="The lab: CE1 → CE2 over SR-MPLS" />
      </GuideSection>

      <GuideSection id="ml-srv6" eyebrow="Healthy · SRv6" title="The same packet over SRv6" tone="ip">
        <p>
          Now PE2&apos;s VRF is configured with <Mono>segment-routing srv6 · alloc mode per-vrf</Mono>. Instead of a label, PE2 allocates an <b className="text-pv-text">End.DT4</b> SID from its locator, <Mono>{CUST_A_DT4}</Mono>, and advertises that. PE1 performs <b className="text-pv-text">H.Encaps.Red</b>: one outer IPv6 header whose destination is the SID. One SID needs no SRH.
        </p>
        <CliPanel run={dpBlock(P6, "PE1", "show bgp vpnv4 unicast vrf CUST-A 10.20.1.0/24", /10\.0\.0\.6 \(metric/, /Origin/)} caption="IOS XR · PE1 — the VPN route now carries an SRv6 SID instead of a label" />
        <CliPanel run={dpOnly(P6, "PE1", "show cef vrf CUST-A 10.20.1.10", /via|SID-list/)} caption="IOS XR · PE1 — H.Encaps.Red with one SID" />
        <p>P1 and P2 do not execute anything: the destination falls inside PE2&apos;s locator, so they route it with an ordinary IPv6 lookup. PE2 recognizes its own SID, decapsulates and looks up the inner IPv4 destination in CUST-A.</p>
        <DpHops s={P6} title="The lab: the outer destination on each link" />
        <DpResult s={P6} title="The lab: CE1 → CE2 over SRv6" />
        <Callout tone="cyan" title="Same path, same service — different instruction" icon="=">
          {wm.overhead} bytes of labels or {w6.overhead} bytes of IPv6 header. Transport and service are two labels in SR-MPLS and one address in SRv6.
        </Callout>
      </GuideSection>

      <GuideSection id="ml-te" eyebrow="Guided lesson" title="Explicit TE in both" tone="warning">
        <DiagramFrame caption="The guided lesson steers PE1 → P1 → P3 → P4 → P2 → PE2 in both encodings.">
          <TeDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "SR-MPLS (this model)", tone: "mpls", tag: `${MPLS_TE_STACK.length} labels`, points: ["Adj-SID(P4→P2) is locally significant", "so Node-SID(P4) must first bring the packet to P4"] },
            { title: "SRv6 (this model)", tone: "ip", tag: `${SRV6_TE_PROGRAM.length} SIDs`, points: ["End.X(P4→P2) is routed via P4's locator", "it reaches P4 and forces the P4→P2 link"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">RFC 8402 also allows globally significant MPLS Adj-SIDs, so this count belongs to the model, not to the architectures.</p>
      </GuideSection>

      <GuideSection id="ml-transit" eyebrow="The real difference" title="What transit routers must know" tone="danger">
        <p>
          Turn off <Mono>segment-routing mpls</Mono> on P2 — its IS-IS adjacencies stay up. For SR-MPLS that is a hole: P1 no longer has a label for PE2 through P2, its entry becomes <b className="text-pv-text">Unlabelled</b>, so it pops the transport label and P2 receives the VPN label {VPN_LABEL_PE2}, which only PE2 can read.
        </p>
        <CliPanel run={dpCli(P2M, "P1", "show mpls forwarding labels 16006")} caption="IOS XR · P1 — the outgoing label toward P2 is gone" />
        <DpResult s={P2M} title="The lab: SR-MPLS through a P2 without labels" />
        <p>For SRv6 nothing changed: P2 forwards on the IPv6 destination like any other packet. SRv6 transit needs only plain IPv6 routing to the owner&apos;s locator.</p>
        <DpResult s={P26} title="The lab: SRv6 through the same P2" />
      </GuideSection>

      <GuideSection id="ml-tilfa" eyebrow="Protection" title="One repair, two encodings" tone="warning">
        <p>
          P1 runs TI-LFA on its link to P2. If that link fails, the post-convergence path is <b className="text-pv-text">{rp.path.join(" → ")}</b> (cost 80). The catch: P4&apos;s own shortest path to P2 still runs back through P3 and P1 (cost 30 against 50 direct). So the repair must bring the packet to P4 <i>and</i> force P4 → P2. The computation is identical in both planes; only the encoding differs.
        </p>
        <DiagramFrame caption="The guided lesson: both repairs sit on top of the real transport instruction (shown for plain transport; the lab carries CUST-A).">
          <TiLfaDiagram />
        </DiagramFrame>
        <CliPanel run={dpOnly(D0, "P1", "show isis fast-reroute 10.0.0.6/32 detail", /./)} caption="IOS XR · P1 — SR-MPLS backup: P node P4 (16004), Q node P2 (Adj-SID 24045)" />
        <CliPanel run={dpOnly(D0, "P1", "show isis fast-reroute 2001:db8:100:2::/64 detail", /./)} caption="IOS XR · P1 — SRv6 backup: one End.X on P4 toward P2" />
        <DpHops s={DM} title="The lab: SR-MPLS repair, label stack on each link" />
        <DpHops s={D6} title="The lab: SRv6 repair, outer destinations on each link" />
        <FieldTable
          title="The same repair, computed by the lab"
          accent="warning"
          columns={["", "SR-MPLS", "SRv6"]}
          rows={[
            ["P1 adds", `[${rp.labels!.join(", ")}] above ${TRANSPORT_LABEL}`, `outer IPv6, DA ${rp.sids![0]}`],
            ["Extra bytes", `+${dm.peakOverhead - dm.overhead}`, `+${d6.peakOverhead - d6.overhead}`],
            ["Who removes it", "P3 pops 16004 (PHP), P4 consumes 24045", "P4 executes End.X with USD"],
            ["Traffic lost", lossText(DM.tests[0].lossMs), lossText(D6.tests[0].lossMs)],
          ]}
        />
      </GuideSection>

      <GuideSection id="ml-bytes" eyebrow="Design" title="The header budget" tone="cyan">
        <DiagramFrame caption={`The guided lesson's ${HEADER_SEGMENTS}-segment program: instruction storage only.`}>
          <HeaderDiagram />
        </DiagramFrame>
        <p>
          A label costs 4 bytes; an IPv6 header 40, and every further SID 16 more in an SRH. In the lab a {1460}-byte customer packet is {1460 + dm.overhead} bytes over SR-MPLS and {1460 + w6.overhead} over SRv6 — and during P1&apos;s repair {1460 + dm.peakOverhead} against {1460 + d6.peakOverhead}. A link with a 1500-byte IP MTU carries the first and drops the second. Compression (the uSID lesson) narrows the gap; jumbo MTUs in the core remove it.
        </p>
      </GuideSection>

      <GuideSection id="ml-working" eyebrow="Evidence" title="What working looks like" tone="success">
        <ChecklistCard
          tone="success"
          title="A healthy dual-plane network"
          mark="✓"
          items={[
            "show isis segment-routing label table: a label for every loopback",
            "show isis segment-routing srv6 locators on each router: its locator Active",
            "show route ipv6 on PE1: every locator learned via IS-IS",
            "show cef vrf CUST-A on PE1: labels imposed, or an SRv6 SID-list",
            "show mpls forwarding on P1: a primary and a (!) backup for 16006",
            "a fresh ping, and a fresh drill, delivered in the plane CUST-A uses",
          ]}
        />
      </GuideSection>

      <GuideSection id="ml-incident" eyebrow="Incident" title="The migration incident" tone="danger">
        <p>
          The guided incident. CUST-A was migrated to SRv6: PE2&apos;s VRF now allocates an End.DT4 SID. Since then CE1 can&apos;t reach CE2. The operations team reports: BGP is up, the VPN route is there with its SID, the route target is unchanged, PE2&apos;s loopback pings. Under SR-MPLS it worked.
        </p>
        <DpResult s={INC} title="The lab: the ticket, a fresh ping" />
        <Callout tone="warning" title="Three tempting repairs that change nothing" icon="!">
          Changing the route target (the route is already imported), restarting BGP (the session and route come back the same) and adding an MPLS VPN label (that just moves CUST-A back to the other plane and hides the fault). None of them touches what SRv6 needs.
        </Callout>
      </GuideSection>

      <GuideSection id="ml-investigate" eyebrow="Incident" title="Investigation" tone="danger">
        <DiagramFrame caption="The same ladder for both planes — what you inspect at each rung differs.">
          <LadderDiagram />
        </DiagramFrame>
        <TroubleshootingFlow
          steps={[
            { question: "Which plane does CUST-A use?", look: "SRv6 — the BGP route carries Sid 2001:db8:100:2:13::" },
            { question: "Is the control plane fine?", look: "Yes — route received, RT imported, next hop 10.0.0.6 reachable" },
            { question: "What does PE1 install?", look: "Nothing — show cef falls through to the default drop" },
            { question: "Can PE1 reach the SID?", look: "No — no route to 2001:db8:100:2::/64" },
            { question: "Does PE2 still have the SID?", look: "Yes, locally — but its IS-IS no longer advertises locator MAIN" },
          ]}
        />
        <CliPanel run={dpBlock(INC, "PE1", "show bgp vpnv4 unicast vrf CUST-A 10.20.1.0/24", /10\.0\.0\.6 \(metric/, /Source AFI/)} caption="IOS XR · PE1 — BGP looks perfect" />
        <CliPanel run={dpOnly(INC, "PE1", "show cef vrf CUST-A 10.20.1.10", /0\.0\.0\.0\/0|drop/)} caption="IOS XR · PE1 — but nothing is installed for 10.20.1.10" />
        <CliPanel run={dpWith(INC, "PE1", "show route ipv6", /i L2 2001:db8:1[01]0:/)} caption="IOS XR · PE1 — every locator except PE2's" />
        <CliPanel run={dpCli(INC, "PE2", "show segment-routing srv6 sid")} caption="IOS XR · PE2 — the End.DT4 still exists locally (BGP allocated it)" />
        <CliPanel run={dpCli(INC, "PE2", "show isis segment-routing srv6 locators")} caption="IOS XR · PE2 — IS-IS advertises no locator" />
        <p>
          That is why SR-MPLS kept working: it reaches PE2 through the prefix-SID of <Mono>10.0.0.6/32</Mono>, which never depended on the SRv6 locator. Each plane has its own reachability, and the migration exposed a gap that SR-MPLS never needed filled.
        </p>
      </GuideSection>

      <GuideSection id="ml-repair" eyebrow="Incident" title="Repair, fresh test, proof" tone="success">
        <p>One change on PE2: advertise locator MAIN in IS-IS again.</p>
        <CliPanel run={{ prompt: "RP/0/RP0/CPU0:PE2(config)#", command: "router isis CORE address-family ipv6 unicast", output: "RP/0/RP0/CPU0:PE2(config-isis-af)#segment-routing srv6\nRP/0/RP0/CPU0:PE2(config-isis-srv6)#locator MAIN\nRP/0/RP0/CPU0:PE2(config-isis-srv6)#commit" }} caption="IOS XR · PE2 — the repair" />
        <CliPanel run={dpOnly(INC_FIX, "PE1", "show cef vrf CUST-A 10.20.1.10", /via|SID-list/)} caption="IOS XR · PE1 — the route is installed again" />
        <DpResult s={INC_FIX} title="The lab: a fresh ping after the fix" />
        <ChecklistCard tone="success" title="Proved, not assumed" mark="✓" items={["PE1 has a route to 2001:db8:100:2::/64 again", "show cef shows H.Encaps.Red with the End.DT4", "a fresh ping is delivered over SRv6", "the lesson: each plane needs its own reachability — a migration must check the new plane's, not the old one's"]} />
      </GuideSection>

      <GuideSection id="ml-other" eyebrow="Beyond this incident" title="Other ways it breaks" tone="warning">
        <FailureSignatures
          items={[
            { tag: "LSP", title: "A P router loses SR-MPLS", tone: "danger", points: ["Unlabelled toward it", "SR-MPLS VPNs drop; SRv6 fine"] },
            { tag: "FRR", title: "No SRv6 SIDs on the repair node", tone: "warning", points: ["SR-MPLS backup only", "SRv6 VPNs lose ~1 s on a cut"] },
            { tag: "MTU", title: "A 1500-byte link on the backup path", tone: "warning", points: ["fine normally", "big SRv6 packets drop during the repair"] },
            { tag: "SID", title: "PE2 loses its prefix-SID", tone: "danger", points: ["no transport label", "VPN label alone, dropped at P1"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Each is a ticket in the SR-MPLS vs SRv6 Lab, together with this incident.</p>
      </GuideSection>

      <GuideSection id="ml-choose" eyebrow="Decisions" title="Trade-offs, not a winner" tone="warning">
        <FieldTable
          title="What differs, and why it matters"
          accent="warning"
          columns={["Aspect", "SR-MPLS", "SRv6"]}
          rows={[
            ["Instruction size", "4-byte labels", "16-byte SIDs, 40-byte headers (compressible)"],
            ["Transit state", "a label entry per destination", "an IPv6 route to each locator"],
            ["Service + transport", "two labels", "one address"],
            ["Operational base", "existing MPLS hardware, tools, skills", "IPv6-native core, programmable endpoints"],
            ["Typical risk", "a hole in the label path", "a missing locator route, MTU"],
          ]}
        />
      </GuideSection>

      <GuideSection id="ml-model" eyebrow="Mental model" title="Mental model" tone="cyan">
        <p>
          Think of one road network with two kinds of parcel labels. SR-MPLS uses short route codes that every depot along the way must look up in its own code book — compact, but a depot without the book can&apos;t forward the parcel. SRv6 writes the destination depot&apos;s full street address on the parcel — longer, but any depot that knows the streets can forward it, and only the destination depot reads the note at the bottom. Both kinds travel the same roads, and when a road closes, the same detour is planned for both. During a move from codes to addresses, every depot must know the new street — a missing street sign stops the address parcels while the coded ones keep flowing.
        </p>
        <Callout tone="cyan" title="When it breaks, ask in this order" icon="→">
          Which plane does the service use? Can the ingress reach the egress in that plane (a label, or a locator route)? Does every transit router support that plane? Is there a backup in that plane? Do the links carry its bytes?
        </Callout>
      </GuideSection>

      <GuideSection id="ml-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Prefix-SID / Node SID", def: `A loopback's SR-MPLS index; label = SRGB base + index (PE2: ${TRANSPORT_LABEL}).` },
            { term: "Adj-SID", def: "A label that forces one adjacency; local to its router (P4→P2: 24045)." },
            { term: "PHP", def: "Penultimate Hop Popping: the router before the owner removes the Node SID label." },
            { term: "Locator", def: "The IPv6 prefix a router's SRv6 SIDs come from (PE2: 2001:db8:100:2::/64)." },
            { term: "End.DT4", def: `Decapsulate and look up IPv4 in a VRF — CUST-A's service SID (${CUST_A_DT4}).` },
            { term: "End.X (USD)", def: "Force one adjacency; with USD, remove the outer header first (the SRv6 repair)." },
            { term: "H.Encaps.Red", def: "Headend encapsulation that puts the first SID in the DA and omits an SRH for one SID." },
            { term: "Unlabelled", def: "An LFIB entry whose next hop has no label for the destination — the label path ends there." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ml-recap" eyebrow="Reference" title="Recap" tone="success">
        <ChecklistCard tone="success" title="You can now" mark="✓" items={["say what the two planes share and what differs", "read labels, locators and SIDs", "follow a VPN packet through each plane", "explain what transit needs in each", "compare a TI-LFA repair and its bytes", "find, fix and prove a fault that hits one plane"]} />
      </GuideSection>

      <GuideSection id="ml-practice" eyebrow="Next" title="Practice it" tone="violet">
        <p>The Deep Dive tab compares the two planes in full: identifiers and SID spaces, the label stack and the SRv6 header, VPN signaling, transit behavior, TE and TI-LFA encodings, MTU, coexistence and migration, IOS XR configuration and verification, and every failure signature with real evidence. The lab lets you run, break and repair both yourself.</p>
        <LessonLabBridge />
        <PresentationBridge>Rewatch the SR-MPLS vs SRv6 presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
