"use client";

import type { ReactNode } from "react";
import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DNode, DPill, FailureSignatures, FieldTable, FlowSteps, GuideSection, Misconceptions, Mono, PacketAnatomy, StateTransition, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DFieldRow } from "@/components/lesson/FundamentalsGuideSvg";
import { ExplainIt, KnowledgeCheck, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { executeCli } from "@/lib/cli/parser";
import type { CliVendor } from "@/lib/cli/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { INITIAL_TTL, V4_FAULT_PREFIX, V4_IP, V4_MAC, V4_PREFIX, blockSize, hostRange, maskOf, networkOf } from "@/lib/sim-engine/scenarios/ipv4Basics";
import { V4_LAB_HOST_C, createV4LabState, fieldOf, v4Decide, v4Owner, type V4LabAction, type V4LabState, type V4Record } from "@/lib/sim-engine/scenarios/ipv4Lab";
import { r1Cli } from "./cliAdapter";
import { v4LabDryRun } from "./ipv4-lab/Ipv4LabBoard";

/**
 * IPv4 DEEP DIVE — the complete IPv4 Basics lesson, taught on THIS network: HOST-A 192.168.10.10/26 and the lab-only
 * HOST-C 192.168.10.30 on SW-A, R1 (.1 | .65), HOST-B 192.168.10.70/26 on SW-B. Every number, frame list, before/after
 * comparison and CLI sample below is produced by running the IPv4 Lab's own model and the real R1 CLI adapter.
 * Later lessons' topics (subnet design, route selection, ICMP, NAT, IPv6…) stay in "Beyond this lesson".
 */

const G = { foundation: "Foundation", decision: "The forwarding decision", header: "The IPv4 header", forward: "End to end", ops: "Operations", master: "Master it", beyond: "Beyond this lesson" };

export const V4_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "v4d-why", label: "Why IPv4 exists", group: G.foundation },
  { id: "v4d-l2l3", label: "Layer 2 vs Layer 3", group: G.foundation },
  { id: "v4d-address", label: "The address model", group: G.foundation },
  { id: "v4d-bits", label: "Network and host bits", group: G.foundation },
  { id: "v4d-prefix", label: "Prefix length and mask", group: G.foundation },
  { id: "v4d-cidr", label: "CIDR notation", group: G.foundation },
  { id: "v4d-decision", label: "Local or remote?", group: G.decision },
  { id: "v4d-and", label: "The AND comparison", group: G.decision },
  { id: "v4d-local", label: "Local delivery", group: G.decision },
  { id: "v4d-remote", label: "Remote delivery", group: G.decision },
  { id: "v4d-gateway", label: "The default gateway", group: G.decision },
  { id: "v4d-nexthop", label: "Next hop vs final destination", group: G.decision },
  { id: "v4d-ipmac", label: "Destination IP vs destination MAC", group: G.decision },
  { id: "v4d-arp", label: "ARP comes after the decision", group: G.decision },
  { id: "v4d-header", label: "IPv4 header anatomy", group: G.header },
  { id: "v4d-addrs", label: "Source and destination", group: G.header },
  { id: "v4d-ttl", label: "TTL", group: G.header },
  { id: "v4d-proto", label: "Protocol", group: G.header },
  { id: "v4d-csum", label: "Header checksum", group: G.header },
  { id: "v4d-changes", label: "What a router changes", group: G.header },
  { id: "v4d-keeps", label: "What a router keeps", group: G.header },
  { id: "v4d-connected", label: "Connected networks", group: G.forward },
  { id: "v4d-hosttree", label: "The host's decision tree", group: G.forward },
  { id: "v4d-router", label: "R1's connected lookup", group: G.forward },
  { id: "v4d-walk-local", label: "Walkthrough: same subnet", group: G.forward },
  { id: "v4d-walk-remote", label: "Walkthrough: remote subnet", group: G.forward },
  { id: "v4d-diff", label: "Before and after R1", group: G.forward },
  { id: "v4d-verify", label: "Operational verification", group: G.ops },
  { id: "v4d-workflow", label: "Troubleshooting workflow", group: G.ops },
  { id: "v4d-incident", label: "The wrong-mask incident", group: G.ops },
  { id: "v4d-signatures", label: "Failure signatures", group: G.ops },
  { id: "v4d-myths", label: "Common misconceptions", group: G.master },
  { id: "v4d-quiz", label: "Knowledge check", group: G.master },
  { id: "v4d-explain", label: "Can you explain it?", group: G.master },
  { id: "v4d-practice", label: "Practise in the IPv4 Lab", group: G.master },
  { id: "v4d-beyond", label: "Subnet design, routing, ICMP, NAT, IPv6…", group: G.beyond },
];

// ------------------------------------------------------------------ one source of truth: the IPv4 Lab model

const A = V4_IP["HOST-A"];
const B = V4_IP["HOST-B"];
const C = V4_LAB_HOST_C.ip;
const GA = V4_IP.R1L;
const GB = V4_IP.R1R;
const MASK = maskOf(V4_PREFIX);
const play = (s: V4LabState, actions: V4LabAction[]) => actions.reduce(v4LabDryRun, s);
const LAB_LOCAL = play(createV4LabState(), [{ type: "send", src: "HOST-A", dst: C }]);
const LAB_AT_R1 = play(LAB_LOCAL, [{ type: "send", src: "HOST-A", dst: B }]);
const LAB_ROUTED = play(LAB_AT_R1, [{ type: "route" }]);
const LAB_INCIDENT = play(LAB_ROUTED, [{ type: "incident" }, { type: "send", src: "HOST-A", dst: B }]);
const lastRec = (s: V4LabState) => s.records[s.records.length - 1];
const REC_LOCAL = lastRec(LAB_LOCAL);
const REC_TO_R1 = lastRec(LAB_AT_R1);
const REC_ROUTE = lastRec(LAB_ROUTED);
const REC_INC = lastRec(LAB_INCIDENT);
const IN_F = REC_ROUTE.frames[REC_ROUTE.routing!.inFrame];
const OUT_F = REC_ROUTE.frames[REC_ROUTE.routing!.outFrame];
const ip = (p: PacketVisual, l: string) => fieldOf(p, /^IPv4/, l);
const eth = (p: PacketVisual, l: string) => fieldOf(p, /^Ethernet/, l);

/** Every frame an action put on the wire (the same list the lab shows). */
const frameRows = (records: V4Record[]) =>
  records.flatMap((r) =>
    // A route record's first frame is the packet R1 received (already listed with the sender's frames).
    r.frames.filter((_f, i) => !(r.kind === "route" && r.routing?.inFrame === i)).map((f) => {
      const isIp = f.protocol !== "ARP";
      const dstMac = eth(f, "Destination MAC");
      return [isIp ? "IPv4" : fieldOf(f, /^ARP/, "Operation").includes("request") ? "ARP request" : "ARP reply", <Mono key="m">{dstMac}</Mono>, v4Owner(dstMac) ?? (dstMac.startsWith("FF") ? "broadcast" : "—"), isIp ? `${ip(f, "Source")} → ${ip(f, "Destination")} · TTL ${ip(f, "TTL")}` : `who has / is at ${fieldOf(f, /^ARP/, "Operation").includes("request") ? fieldOf(f, /^ARP/, "Target IP") : fieldOf(f, /^ARP/, "Sender IP")}`];
    }),
  );
const FRAME_COLS = ["Frame", "Ethernet destination", "= device", "IPv4 / ARP"];

function cli(state: V4LabState, vendor: CliVendor, command: string) {
  const set = r1Cli(vendor, state);
  const r = executeCli(set, command);
  return { prompt: set.prompt, command, output: r.kind === "ok" ? r.output : "" };
}
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
const Strong = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;

function LabBridge({ label, children }: { label: string; children: ReactNode }) {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label={label} onPractice={openLab}>
      {children}
    </PracticeBridge>
  );
}

// ------------------------------------------------------------------ diagrams

function HeaderDiagram() {
  const row = (y: number, fields: { label: string; w: number; strong?: boolean; color?: string }[]) => <DFieldRow x={40} y={y} h={30} fields={fields.map((f) => ({ ...f, color: f.color ?? D.ip }))} />;
  const u = 560 / 32;
  return (
    <DiagramSvg h={220} label="IPv4 header, 20 bytes without options: Version, IHL, DSCP/ECN, Total Length; Identification, Flags, Fragment Offset; TTL, Protocol, Header Checksum; Source Address; Destination Address">
      <text x={40} y={20} fill={D.muted} fontSize={10}>
        0 ··· 32 bits per row ··· 31
      </text>
      {row(28, [
        { label: "Ver", w: 4 * u },
        { label: "IHL", w: 4 * u },
        { label: "DSCP/ECN", w: 8 * u },
        { label: "Total Length", w: 16 * u },
      ])}
      {row(58, [
        { label: "Identification", w: 16 * u },
        { label: "Flg", w: 3 * u },
        { label: "Fragment Offset", w: 13 * u },
      ])}
      {row(88, [
        { label: "TTL", w: 8 * u, strong: true, color: D.warning },
        { label: "Protocol", w: 8 * u },
        { label: "Header Checksum", w: 16 * u, strong: true, color: D.warning },
      ])}
      {row(118, [{ label: "Source Address", w: 32 * u, strong: true }])}
      {row(148, [{ label: "Destination Address", w: 32 * u, strong: true }])}
      <text x={40} y={200} fill={D.warning} fontSize={10.5} fontWeight={700}>
        Amber fields change at every router. The addresses change only with NAT (not in this lesson).
      </text>
    </DiagramSvg>
  );
}

function PrefixDiagram() {
  const prefixes = [24, 25, 26, 27];
  return (
    <DiagramSvg h={150} label={`Prefix sizes: ${prefixes.map((p) => `/${p} mask ${maskOf(p)} block ${blockSize(p)}`).join(", ")}`}>
      {prefixes.map((p, i) => {
        const y = 22 + i * 30;
        const w = (blockSize(p) / 256) * 290;
        return (
          <g key={p}>
            <text x={20} y={y + 12} fill={D.text} fontSize={11} fontWeight={700} fontFamily="monospace">
              /{p}
            </text>
            <text x={60} y={y + 12} fill={D.muted} fontSize={10} fontFamily="monospace">
              {maskOf(p)}
            </text>
            <rect x={200} y={y} width={Math.max(3, w)} height={16} rx={3} fill={p === V4_PREFIX ? D.violet : D.ip} fillOpacity={0.5} />
            <text x={200 + Math.max(3, w) + 8} y={y + 12} fill={D.muted} fontSize={10}>
              {blockSize(p)} addresses · {hostRange("10.0.0.0", p)?.count} hosts
            </text>
          </g>
        );
      })}
    </DiagramSvg>
  );
}

function BitsDiagram() {
  const rows: [string, string][] = [
    ["HOST-A", A],
    ["HOST-C", C],
    ["HOST-B", B],
  ];
  const net = V4_PREFIX - 24;
  return (
    <DiagramSvg h={170} label={`Last octet of HOST-A ${A}, HOST-C ${C} and HOST-B ${B} in bits; with /${V4_PREFIX} the first ${net} bits of the last octet are network bits: HOST-A and HOST-C share 00, HOST-B has 01`}>
      <text x={20} y={20} fill={D.muted} fontSize={10}>
        192.168.10 is shared by everyone here (24 network bits); /{V4_PREFIX} adds {net} more network bits inside the last octet
      </text>
      {rows.map(([name, addr], r) => {
        const bits = Number(addr.split(".")[3]).toString(2).padStart(8, "0");
        const y = 48 + r * 38;
        return (
          <g key={name}>
            <text x={20} y={y + 14} fill={D.text} fontSize={11} fontWeight={700}>
              {name}
            </text>
            <text x={90} y={y + 14} fill={D.muted} fontSize={10.5} fontFamily="monospace">
              {addr}
            </text>
            {[...bits].map((b, i) => (
              <g key={i}>
                <rect x={240 + i * 30 + (i >= net ? 10 : 0)} y={y} width={26} height={22} rx={4} fill={i < net ? D.cyan : D.box} fillOpacity={i < net ? 0.22 : 1} stroke={i < net ? D.cyan : D.line} />
                <text x={253 + i * 30 + (i >= net ? 10 : 0)} y={y + 15} textAnchor="middle" fill={i < net ? D.cyan : D.text} fontSize={11} fontFamily="monospace">
                  {b}
                </text>
              </g>
            ))}
          </g>
        );
      })}
      <text x={240} y={164} fill={D.cyan} fontSize={10} fontWeight={700}>
        network
      </text>
      <text x={330} y={164} fill={D.muted} fontSize={10}>
        host bits
      </text>
    </DiagramSvg>
  );
}

function SplitDiagram() {
  return (
    <DiagramSvg h={210} label={`Remote delivery: the IPv4 header carries destination ${B} end to end, while the Ethernet destination is R1 on the first link and HOST-B on the second`}>
      <DNode x={80} y={60} label="HOST-A" sub={A} w={130} />
      <DNode x={320} y={60} label="R1" sub={`${GA} | ${GB}`} accent={D.violet} w={150} />
      <DNode x={560} y={60} label="HOST-B" sub={B} w={130} />
      <DArrow x1={147} y1={60} x2={243} y2={60} color={D.ip} />
      <DArrow x1={397} y1={60} x2={493} y2={60} color={D.ip} />
      <DPill x={195} y={110} text={`Eth dst ${eth(REC_TO_R1.frames[REC_TO_R1.ipFrame!], "Destination MAC")} (R1)`} color={D.eth} w={230} />
      <DPill x={445} y={110} text={`Eth dst ${eth(OUT_F, "Destination MAC")} (HOST-B)`} color={D.eth} w={230} />
      <DPill x={195} y={145} text={`IPv4 dst ${B} · TTL ${ip(IN_F, "TTL")}`} color={D.ip} w={210} />
      <DPill x={445} y={145} text={`IPv4 dst ${B} · TTL ${ip(OUT_F, "TTL")}`} color={D.ip} w={210} />
      <text x={320} y={195} textAnchor="middle" fill={D.muted} fontSize={10}>
        Layer 2 describes one link. Layer 3 describes the whole journey.
      </text>
    </DiagramSvg>
  );
}

function TtlDiagram() {
  return (
    <DiagramSvg h={180} label="A routing loop between RA and RB: each pass decrements TTL; at 0 the packet is discarded instead of circulating forever">
      <DNode x={160} y={80} label="RA" accent={D.ip} w={80} />
      <DNode x={420} y={80} label="RB" accent={D.ip} w={80} />
      <DArrow x1={202} y1={66} x2={378} y2={66} color={D.warning} label="TTL 3 → 2" />
      <DArrow x1={378} y1={96} x2={202} y2={96} color={D.warning} label="TTL 2 → 1" labelDy={18} />
      <DPill x={160} y={146} text="TTL 1 → 0: discard" color={D.danger} w={150} />
      <text x={320} y={160} fill={D.muted} fontSize={10}>
        (the router also reports it back — ICMP is its own lesson)
      </text>
    </DiagramSvg>
  );
}

// ------------------------------------------------------------------ knowledge checks

const QUIZ: KnowledgeQuestion[] = [
  { id: "q1", prompt: `HOST-A is ${A}/${V4_PREFIX}. Is ${C} local?`, options: [{ id: "a", label: "Yes — both AND to 192.168.10.0" }, { id: "b", label: "No — different last octet" }], correctId: "a", explanation: `${A} AND ${MASK} = ${networkOf(A, V4_PREFIX)}; ${C} AND ${MASK} = ${networkOf(C, V4_PREFIX)}.` },
  { id: "q2", prompt: `HOST-A sends to ${B}. Which address does it ARP for?`, options: [{ id: "a", label: GA }, { id: "b", label: B }, { id: "c", label: GB }], correctId: "a", explanation: "Remote destination → next hop is the default gateway; ARP resolves only the next hop." },
  { id: "q3", prompt: `In HOST-A's frame to ${B}, what is the IPv4 destination?`, options: [{ id: "a", label: B }, { id: "b", label: GA }], correctId: "a", explanation: "The IPv4 header always carries the final destination; only the Ethernet destination is the gateway." },
  { id: "q4", prompt: "Which fields does R1 change when it forwards the packet?", options: [{ id: "a", label: "Both MACs, TTL and the header checksum" }, { id: "b", label: "The source IPv4 address" }, { id: "c", label: "Nothing" }], correctId: "a", explanation: "A new Ethernet header for the next link; TTL − 1; the checksum is recomputed because the header changed." },
  { id: "q5", prompt: `What TTL does HOST-B receive?`, options: [{ id: "a", label: String(INITIAL_TTL - 1) }, { id: "b", label: String(INITIAL_TTL) }, { id: "c", label: "It depends on the time taken" }], correctId: "a", explanation: "One router hop: 64 − 1. TTL counts hops, not seconds." },
  { id: "q6", prompt: `HOST-A's mask is wrongly /${V4_FAULT_PREFIX}. What does it do when sending to ${B}?`, options: [{ id: "a", label: `Decides LOCAL and ARPs for ${B} directly` }, { id: "b", label: "Sends to its gateway as usual" }, { id: "c", label: "Asks R1 for a route" }], correctId: "a", explanation: `Under /${V4_FAULT_PREFIX} both addresses AND to 192.168.10.0, so HOST-A never selects the gateway; its ARP for ${B} gets no answer.` },
  { id: "q7", prompt: "HOST-A's gateway is wrong but its mask is right. What changes compared with a wrong mask?", options: [{ id: "a", label: "It still decides REMOTE; only the next hop is unusable" }, { id: "b", label: "Nothing — same symptom, same cause" }], correctId: "a", explanation: "Wrong mask → wrong class (LOCAL). Wrong gateway → right class, wrong next hop." },
];

// ------------------------------------------------------------------ content

export function Ipv4DeepDiveContent() {
  const route = cli(LAB_ROUTED, "cisco", "show ip route");
  const arp = cli(LAB_ROUTED, "cisco", "show ip arp");
  const jroute = cli(LAB_ROUTED, "juniper", "show route");
  const brief = cli(LAB_ROUTED, "cisco", "show ip interface brief");
  const wrong = v4Decide("HOST-A", { prefix: V4_FAULT_PREFIX, gateway: GA }, B);
  const right = v4Decide("HOST-A", { prefix: V4_PREFIX, gateway: GA }, B);
  const local = v4Decide("HOST-A", { prefix: V4_PREFIX, gateway: GA }, C);

  return (
    <div className="space-y-12">
      {/* ------------------------------------------------------------ Foundation */}
      <GuideSection id="v4d-why" eyebrow="Foundation" title="Why IPv4 exists" tone="ip">
        <p>
          Ethernet delivers frames inside one LAN. HOST-A ({A}) and HOST-B ({B}) are on <Strong>different LANs</Strong>, joined by R1. To get a packet across, every host and router needs an address that says <Strong>which network</Strong> a device is on — not just which network card it is. That address is IPv4.
        </p>
      </GuideSection>

      <GuideSection id="v4d-l2l3" eyebrow="Foundation" title="Layer 2 vs Layer 3" tone="ip">
        <CompareCards
          items={[
            { title: "Layer 2 — Ethernet (MAC)", tone: "ethernet", tag: "one link", points: ["Gets a frame to the next device on THIS LAN", "Rewritten at every router", `e.g. HOST-A ${V4_MAC["HOST-A"]} → R1 ${V4_MAC.R1L}`] },
            { title: "Layer 3 — IPv4", tone: "ip", tag: "whole journey", points: ["Names the final destination", "Unchanged across routers (TTL aside)", `e.g. ${A} → ${B}`] },
          ]}
        />
      </GuideSection>

      <GuideSection id="v4d-address" eyebrow="Foundation" title="The address model" tone="ip">
        <p>
          An IPv4 address is 32 bits, written as four decimal octets. <Mono>{A}</Mono> is just shorthand. On its own an address says nothing about where its network ends — that needs the <Strong>prefix length</Strong>, which every host is configured with.
        </p>
      </GuideSection>

      <GuideSection id="v4d-bits" eyebrow="Foundation" title="Network and host bits" tone="cyan">
        <DiagramFrame caption="Everyone here shares 192.168.10; with /26 the last octet's first two bits finish the network part.">
          <BitsDiagram />
        </DiagramFrame>
        <p>The network bits are equal for every device on the same network; the host bits tell those devices apart. HOST-A and HOST-C share <Mono>00</Mono>; HOST-B has <Mono>01</Mono> — a different network.</p>
      </GuideSection>

      <GuideSection id="v4d-prefix" eyebrow="Foundation" title="Prefix length and mask" tone="cyan">
        <p>
          <Mono>/{V4_PREFIX}</Mono> means “the first {V4_PREFIX} bits are the network”. The same thing written as a mask is <Mono>{MASK}</Mono>: ones for network bits, zeros for host bits. Each extra prefix bit halves the block.
        </p>
        <DiagramFrame caption="The four prefixes the lab lets you try on HOST-A.">
          <PrefixDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="v4d-cidr" eyebrow="Foundation" title="CIDR notation" tone="cyan">
        <p>
          <Mono>{A}/{V4_PREFIX}</Mono> is CIDR notation: address plus prefix length. Old “class” rules tied network size to the first octet; they have not decided anything since CIDR. A <Mono>192.168.x.x</Mono> address is not automatically a /24 — here it is a /26.
        </p>
      </GuideSection>

      {/* ------------------------------------------------------------ The decision */}
      <GuideSection id="v4d-decision" eyebrow="The decision" title="Local or remote?" tone="warning">
        <KnowledgeCheck question={{ id: "p-dec", prompt: `Before reading on: HOST-A (${A}/${V4_PREFIX}) wants to reach ${B}. Local or remote?`, options: [{ id: "r", label: "Remote" }, { id: "l", label: "Local — the first three octets match" }], correctId: "r", explanation: `With /${V4_PREFIX} the boundary is inside the last octet: ${networkOf(B, V4_PREFIX)} ≠ ${networkOf(A, V4_PREFIX)}.` }} />
        <p>Before every send, a host asks one question: is the destination on MY network? It answers with its <Strong>own</Strong> address and mask — the router is not consulted, and the destination&apos;s own mask is irrelevant.</p>
      </GuideSection>

      <GuideSection id="v4d-and" eyebrow="The decision" title="The AND comparison" tone="warning">
        <FieldTable
          title={`HOST-A's comparisons with its mask ${MASK}`}
          columns={["Destination", "Destination AND mask", "HOST-A AND mask", "Result"]}
          rows={[
            [C, local.dstNet, local.srcNet, local.local ? "LOCAL" : "REMOTE"],
            [B, right.dstNet, right.srcNet, right.local ? "LOCAL" : "REMOTE"],
          ]}
        />
        <p>AND keeps the network bits and zeroes the host bits. Equal results → same network → LOCAL.</p>
      </GuideSection>

      <GuideSection id="v4d-local" eyebrow="The decision" title="Local delivery" tone="cyan">
        <p>
          LOCAL means the next hop is the destination itself: HOST-A sends straight to HOST-C on SW-A. R1 is not involved (it only sees an ARP broadcast and ignores it, because it is not for R1&apos;s address).
        </p>
      </GuideSection>

      <GuideSection id="v4d-remote" eyebrow="The decision" title="Remote delivery" tone="cyan">
        <p>REMOTE means the destination is on another network: HOST-A hands the packet to its default gateway, R1, which knows how to reach the other network.</p>
      </GuideSection>

      <GuideSection id="v4d-gateway" eyebrow="The decision" title="The default gateway" tone="violet">
        <p>
          HOST-A&apos;s default gateway is <Mono>{GA}</Mono> — R1&apos;s interface on HOST-A&apos;s own LAN. It must be on-link: HOST-A can only reach its gateway directly. HOST-B&apos;s gateway is R1&apos;s other address, <Mono>{GB}</Mono>. A host uses its gateway only for REMOTE destinations.
        </p>
      </GuideSection>

      <GuideSection id="v4d-nexthop" eyebrow="The decision" title="Next hop vs final destination" tone="violet">
        <FieldTable
          title="The two addresses every send involves"
          columns={["Destination", "Final destination (IPv4 header)", "Next hop (where the frame goes)"]}
          rows={[
            [`HOST-C ${C}`, C, `${local.nextHop} — HOST-C itself`],
            [`HOST-B ${B}`, B, `${right.nextHop} — the default gateway`],
          ]}
        />
      </GuideSection>

      <GuideSection id="v4d-ipmac" eyebrow="The decision" title="Destination IP vs destination MAC" tone="violet">
        <DiagramFrame caption="Values from the lab's model.">
          <SplitDiagram />
        </DiagramFrame>
        <Callout tone="ip" title="The rule">IP destination = the remote host. Ethernet destination = the default gateway. The router never becomes the IP destination.</Callout>
      </GuideSection>

      <GuideSection id="v4d-arp" eyebrow="The decision" title="ARP comes after the decision" tone="arp">
        <StateTransition
          states={[
            { label: "Destination IPv4", detail: B, tone: "ip" },
            { label: "My mask → REMOTE", detail: `${right.dstNet} ≠ ${right.srcNet}`, tone: "warning" },
            { label: "Next hop", detail: `gateway ${right.nextHop}`, tone: "violet" },
            { label: "ARP for the next hop", detail: `who has ${right.nextHop}?`, tone: "arp" },
          ]}
        />
        <p>ARP never decides local vs remote; it only resolves the MAC of the next hop IPv4 already chose. That is why HOST-A never ARPs for {B}: it is not on HOST-A&apos;s LAN, so no one there could answer.</p>
      </GuideSection>

      {/* ------------------------------------------------------------ Header */}
      <GuideSection id="v4d-header" eyebrow="The header" title="IPv4 header anatomy" tone="ip">
        <DiagramFrame caption="20 bytes without options (IHL = 5).">
          <HeaderDiagram />
        </DiagramFrame>
        <PacketAnatomy
          title={`HOST-A's packet to HOST-B, as it leaves HOST-A (values from the lab)`}
          layers={[
            {
              name: "IPv4 header",
              tone: "ip",
              fields: [
                { name: "Version · IHL", value: `${ip(IN_F, "Version")} · ${ip(IN_F, "IHL")}`, why: "IPv4, 20-byte header (no options)." },
                { name: "DSCP / ECN", value: ip(IN_F, "DSCP / ECN"), why: "Priority marking and congestion signalling — not used here." },
                { name: "Total Length", value: ip(IN_F, "Total Length"), why: "Header + UDP header + data, in bytes." },
                { name: "Identification · Flags · Fragment Offset", value: `${ip(IN_F, "Identification")} · ${ip(IN_F, "Flags")} · ${ip(IN_F, "Fragment Offset")}`, why: "Fragmentation fields; DF set, never fragmented here." },
                { name: "TTL", value: ip(IN_F, "TTL"), why: "Hop limit; each router subtracts one.", key: true },
                { name: "Protocol", value: ip(IN_F, "Protocol"), why: "What the payload is." },
                { name: "Header Checksum", value: ip(IN_F, "Header Checksum"), why: "Error check over the header only.", key: true },
                { name: "Source · Destination", value: `${ip(IN_F, "Source")} → ${ip(IN_F, "Destination")}`, why: "End to end — the final destination.", key: true },
              ],
            },
          ]}
        />
      </GuideSection>

      <GuideSection id="v4d-addrs" eyebrow="The header" title="Source and destination" tone="ip">
        <p>The source is the original sender, the destination is the final receiver — for the whole journey. HOST-B receives the packet with source <Mono>{ip(OUT_F, "Source")}</Mono> even though the frame came from R1.</p>
      </GuideSection>

      <GuideSection id="v4d-ttl" eyebrow="The header" title="TTL" tone="warning">
        <p>
          TTL (Time To Live) is a <Strong>hop limit</Strong>, not a time. HOST-A sends {ip(IN_F, "TTL")}; R1 forwards {ip(OUT_F, "TTL")}. A router that would decrement it to 0 discards the packet instead, so routing loops can&apos;t circulate forever.
        </p>
        <DiagramFrame caption="Why TTL exists.">
          <TtlDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="v4d-proto" eyebrow="The header" title="Protocol" tone="ip">
        <p>
          <Mono>{ip(IN_F, "Protocol")}</Mono> tells HOST-B which transport protocol to hand the payload to. TCP is 6, ICMP is 1. Routers forward without reading the payload.
        </p>
      </GuideSection>

      <GuideSection id="v4d-csum" eyebrow="The header" title="Header checksum" tone="warning">
        <p>
          The checksum covers the header only (RFC 791 ones&apos;-complement sum). Because TTL is part of the header, R1 must recompute it: <Mono>{ip(IN_F, "Header Checksum")}</Mono> becomes <Mono>{ip(OUT_F, "Header Checksum")}</Mono> when TTL goes {ip(IN_F, "TTL")} → {ip(OUT_F, "TTL")}. Values computed by the lab, not invented.
        </p>
      </GuideSection>

      <GuideSection id="v4d-changes" eyebrow="The header" title="What a router changes" tone="warning">
        <ChecklistCard tone="warning" mark="Δ" title="Changed by R1" items={[`Ethernet source: ${eth(IN_F, "Source MAC")} → ${eth(OUT_F, "Source MAC")} (R1 ge-0/0/1)`, `Ethernet destination: ${eth(IN_F, "Destination MAC")} → ${eth(OUT_F, "Destination MAC")} (HOST-B)`, `TTL: ${ip(IN_F, "TTL")} → ${ip(OUT_F, "TTL")}`, `Header checksum: ${ip(IN_F, "Header Checksum")} → ${ip(OUT_F, "Header Checksum")}`]} />
      </GuideSection>

      <GuideSection id="v4d-keeps" eyebrow="The header" title="What a router keeps" tone="success">
        <ChecklistCard tone="success" mark="=" title="Unchanged" items={[`Source ${ip(OUT_F, "Source")} and destination ${ip(OUT_F, "Destination")}`, `Identification ${ip(OUT_F, "Identification")}, Flags, Fragment Offset, Total Length, Protocol`, "The UDP payload"]} />
        <p>Address changes would need NAT, which this network does not do.</p>
      </GuideSection>

      {/* ------------------------------------------------------------ End to end */}
      <GuideSection id="v4d-connected" eyebrow="End to end" title="Connected networks" tone="cyan">
        <p>
          R1 knows a network because it has an interface on it: <Mono>{GA}/{V4_PREFIX}</Mono> on ge-0/0/0 gives the connected route <Mono>{networkOf(GA, V4_PREFIX)}/{V4_PREFIX}</Mono>, and <Mono>{GB}/{V4_PREFIX}</Mono> on ge-0/0/1 gives <Mono>{networkOf(GB, V4_PREFIX)}/{V4_PREFIX}</Mono>. No routing protocol, no static routes.
        </p>
      </GuideSection>

      <GuideSection id="v4d-hosttree" eyebrow="End to end" title="The host's decision tree" tone="warning">
        <FlowSteps
          steps={[
            { title: "Destination IPv4", body: "Taken from the application.", tone: "ip" },
            { title: "Apply MY mask", body: "My address AND mask vs destination AND mask.", tone: "warning" },
            { title: "LOCAL → next hop = destination", body: "ARP for the destination itself.", tone: "cyan" },
            { title: "REMOTE → next hop = gateway", body: "ARP for the gateway.", tone: "violet" },
            { title: "Frame and send", body: "Ethernet to the next hop's MAC; IPv4 to the final destination.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="v4d-router" eyebrow="End to end" title="R1's connected lookup" tone="violet">
        <StateTransition
          states={[
            { label: "Frame to my MAC", detail: "accept", tone: "ethernet" },
            { label: "Look up destination", detail: `${B} ∈ ${REC_ROUTE.routing!.route}`, tone: "ip" },
            { label: "Egress", detail: `${REC_ROUTE.routing!.egress} (connected → next hop = ${B})`, tone: "violet" },
            { label: "ARP on egress LAN", detail: `who has ${B}?`, tone: "arp" },
            { label: "TTL − 1, checksum, new frame", detail: `TTL ${ip(OUT_F, "TTL")}`, tone: "warning" },
          ]}
        />
      </GuideSection>

      <GuideSection id="v4d-walk-local" eyebrow="End to end" title="Walkthrough: same subnet" tone="cyan">
        <FieldTable title={`HOST-A → HOST-C ${C}, empty ARP caches (from the lab's model)`} columns={FRAME_COLS} rows={frameRows([REC_LOCAL])} />
        <p>One ARP for the destination, one IPv4 frame straight to HOST-C. R1 routed {LAB_LOCAL.r1Forwarded} packets.</p>
      </GuideSection>

      <GuideSection id="v4d-walk-remote" eyebrow="End to end" title="Walkthrough: remote subnet" tone="violet">
        <FieldTable title={`HOST-A → HOST-B ${B} (from the lab's model)`} columns={FRAME_COLS} rows={frameRows([REC_TO_R1, REC_ROUTE])} />
        <p>HOST-A ARPs for the gateway (not for {B}); R1 ARPs for HOST-B on its other LAN and forwards a new frame with TTL {ip(OUT_F, "TTL")}.</p>
        <LabBridge label="Practise this in the IPv4 Lab">Predict each ARP target and each Ethernet destination before the frames move.</LabBridge>
      </GuideSection>

      <GuideSection id="v4d-diff" eyebrow="End to end" title="Before and after R1" tone="warning">
        <FieldTable
          title="The same packet on either side of R1 (from the lab's model)"
          columns={["Field", "Before R1", "After R1", ""]}
          rows={(
            [
              ["Ethernet source", eth(IN_F, "Source MAC"), eth(OUT_F, "Source MAC")],
              ["Ethernet destination", eth(IN_F, "Destination MAC"), eth(OUT_F, "Destination MAC")],
              ["TTL", ip(IN_F, "TTL"), ip(OUT_F, "TTL")],
              ["Header checksum", ip(IN_F, "Header Checksum"), ip(OUT_F, "Header Checksum")],
              ["Identification · Flags", `${ip(IN_F, "Identification")} · ${ip(IN_F, "Flags")}`, `${ip(OUT_F, "Identification")} · ${ip(OUT_F, "Flags")}`],
              ["Source IPv4", ip(IN_F, "Source"), ip(OUT_F, "Source")],
              ["Destination IPv4", ip(IN_F, "Destination"), ip(OUT_F, "Destination")],
            ] as [string, string, string][]
          ).map(([f, a, b]) => [f, <Mono key="a">{a}</Mono>, <Mono key="b">{b}</Mono>, a === b ? "unchanged" : "CHANGED"])}
        />
      </GuideSection>

      {/* ------------------------------------------------------------ Operations */}
      <GuideSection id="v4d-verify" eyebrow="Operations" title="Operational verification" tone="cyan">
        <p>Hosts show their address, mask, gateway and ARP cache; R1 — the managed router — answers on its CLI. Outputs below are R1 after the remote walkthrough:</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <CliPanel {...brief} caption="Cisco: interfaces and addresses" />
          <CliPanel {...arp} caption="Cisco: R1's ARP cache" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <CliPanel {...route} caption="Cisco: connected routes" />
          <CliPanel {...jroute} caption="Junos: the same table" />
        </div>
      </GuideSection>

      <GuideSection id="v4d-workflow" eyebrow="Operations" title="Troubleshooting workflow" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Symptom — which destinations fail, which work?", look: "HOST-A reaches HOST-C but not HOST-B." },
            { question: "Observation — what did the host decide?", look: "Start from the forwarding decision, not from the router." },
            { question: "Evidence — what did the host do next?", look: "Which address did it ARP for? Did the ARP complete? Did R1 receive an IPv4 packet? What is configured?" },
            { question: "Hypothesis — one cause for all of it", look: "Route? Gateway? Mask? Destination down? Switch?" },
            { question: "Test — prove it with the host's own arithmetic", look: "Repeat the AND with the configured mask." },
            { question: "Repair and verify", look: "Fix the cause; prove it with traffic: decision, next hop, ARP target, R1, TTL, delivery." },
          ]}
        />
      </GuideSection>

      <GuideSection id="v4d-incident" eyebrow="Operations" title="The wrong-mask incident" tone="danger">
        <FieldTable
          title={`HOST-A → HOST-B with HOST-A at /${V4_FAULT_PREFIX} (from the lab's model)`}
          columns={["Evidence", "Value"]}
          rows={[
            ["Decision", `${wrong.srcIp} AND ${wrong.mask} = ${wrong.srcNet}; ${wrong.dst} AND ${wrong.mask} = ${wrong.dstNet} → ${wrong.local ? "LOCAL" : "REMOTE"}`],
            ["Next hop", `${wrong.nextHop} — the destination itself`],
            ["ARP", `who has ${REC_INC.arp[0]?.ip}? → ${REC_INC.arp[0]?.outcome === "no-reply" ? "no reply, INCOMPLETE" : REC_INC.arp[0]?.outcome}`],
            ["IPv4 packets sent", REC_INC.frameKinds.includes("ipv4") ? "yes" : "none"],
            ["R1", `connected 192.168.10.64/26 present; routed count unchanged (${LAB_INCIDENT.r1Forwarded})`],
          ]}
        />
        <Callout tone="danger" title="Root cause">
          HOST-A&apos;s mask makes {B} look local, so it never selects its gateway. HOST-B is on another LAN; R1 answers ARP only for its own addresses (no Proxy ARP), so the ARP never completes. Proxy ARP on R1 would make the traffic flow — and hide the misconfigured host. The fix is HOST-A&apos;s prefix: /{V4_PREFIX}.
        </Callout>
        <LabBridge label="Troubleshoot it in the IPv4 Lab">Reproduce the ticket, gather the evidence (including R1&apos;s CLI), prove the cause with the AND, repair and verify with traffic.</LabBridge>
      </GuideSection>

      <GuideSection id="v4d-signatures" eyebrow="Operations" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "A", title: "Host ARPs for a remote address", tone: "danger", points: ["Decision says LOCAL for an off-subnet destination", "ARP never completes; no IPv4 packet at the router", "→ wrong mask (too short)"] },
            { tag: "B", title: "Host ARPs for its gateway, no answer", tone: "warning", points: ["Decision is REMOTE (correct)", "Next hop never answers ARP", "→ wrong or unreachable default gateway"] },
            { tag: "C", title: "Local destinations work, remote ones don't", tone: "warning", points: ["Check the decision for a remote destination first"] },
            { tag: "D", title: "Packet reaches the router, goes no further", tone: "violet", points: ["The host side is fine", "→ the router's routes (Routing Fundamentals)"] },
          ]}
        />
      </GuideSection>

      {/* ------------------------------------------------------------ Master it */}
      <GuideSection id="v4d-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "The subnet mask belongs to the router only.", correction: "Every host has one and uses it for every send — HOST-A's /26 decides whether HOST-B is local." },
            { myth: "A host sends all traffic to the gateway.", correction: `Only REMOTE traffic. HOST-A → HOST-C (${C}) goes straight to HOST-C.` },
            { myth: "A host ARPs for every destination IP, even remote ones.", correction: `For remote destinations it ARPs for the gateway (${GA}), never for ${B}.` },
            { myth: "The gateway becomes the destination IP.", correction: `The IPv4 destination stays ${B}; only the Ethernet destination is R1.` },
            { myth: "The router changes the packet's source and destination IP.", correction: "Not without NAT. R1 changes both MACs, TTL and the checksum." },
            { myth: "MAC addresses travel unchanged end to end.", correction: "Each link gets a new Ethernet header; the MACs change at every router." },
            { myth: "TTL is a time measured in seconds.", correction: "It is a hop count: 64 leaving HOST-A, 63 after R1." },
            { myth: "If the IP address is different, the destination must be remote.", correction: `${C} differs from ${A} but is local: both are in ${networkOf(A, V4_PREFIX)}/${V4_PREFIX}.` },
            { myth: "A /24 means the first three octets are always the network — for every prefix.", correction: `The prefix decides. At /${V4_PREFIX} the network ends 2 bits into the last octet.` },
            { myth: "ARP decides whether the destination is local.", correction: "The host's mask decides; ARP only resolves the chosen next hop." },
            { myth: "The routing table and the ARP table are the same thing.", correction: "Routes map destination networks to interfaces/next hops; ARP maps a neighbour's IPv4 to its MAC." },
          ]}
        />
      </GuideSection>

      <GuideSection id="v4d-quiz" eyebrow="Master it" title="Knowledge check" tone="success">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="v4d-explain" eyebrow="Master it" title="Can you explain it?" tone="success">
        <ExplainIt
          items={[
            { q: `Why does HOST-A ARP for ${GA} when it sends to ${B}?`, a: `Its own /${V4_PREFIX} makes ${B} remote, so the next hop is the default gateway ${GA}; ARP resolves only the next hop's MAC.` },
            { q: "What does R1 change, and why?", a: "Both MACs (a new frame for the next link), TTL − 1 (hop limit) and the header checksum (the header changed). The IPv4 addresses stay, because the destination is still HOST-B." },
            { q: "Why does a wrong mask break remote traffic but not local traffic?", a: `A too-short mask makes remote addresses look local, so the host ARPs for them directly and never uses its gateway. Truly local destinations like ${C} are local under both masks.` },
          ]}
        />
      </GuideSection>

      <GuideSection id="v4d-practice" eyebrow="Practice" title="Practise in the IPv4 Lab" tone="cyan">
        <ChecklistCard tone="cyan" title="In the lab you will" mark="→" items={["Make HOST-A's local/remote decision for HOST-C and HOST-B", "Watch live ARP resolve the destination (local) or the gateway (remote)", "Compare the packet before and after R1, field by field", "Check R1's routes and ARP cache on Cisco and Junos", "Troubleshoot the wrong-mask incident and verify the fix", "In free play: change HOST-A's prefix, try a wrong gateway"]} />
        <LabBridge label="Open the IPv4 Lab">Same network plus a lab-only HOST-C. Nothing you do there changes your lesson progress.</LabBridge>
      </GuideSection>

      {/* ------------------------------------------------------------ Beyond */}
      <GuideSection id="v4d-beyond" eyebrow="Beyond this lesson" title="Not covered here — on purpose" tone="violet">
        <FieldTable
          title="Later lessons and topics"
          columns={["Topic", "Where / in short"]}
          rows={[
            ["Subnet design (VLSM)", "Subnetting Design Lab: sizing and placing many networks."],
            ["Route selection, static and default routes", "Routing Fundamentals: longest-prefix match across several routes."],
            ["Ping, traceroute, TTL-expired reports", "ICMP & Network Diagnostics."],
            ["Fragmentation", "Identification/Flags/Offset exist; this lesson never fragments (DF set)."],
            ["NAT", "Rewrites addresses — the one case where a router changes them."],
            ["Proxy ARP", "A router answering ARP for others; a workaround, not a fix for wrong masks."],
            ["/31, /32, aggregation", "Special prefixes and route summarisation — later lessons."],
            ["IPv6", "128-bit addresses; neighbour discovery instead of ARP."],
          ]}
        />
      </GuideSection>
    </div>
  );
}
