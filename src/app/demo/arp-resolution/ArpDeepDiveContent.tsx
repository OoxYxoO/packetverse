import type { ReactNode } from "react";
import { Callout, ChecklistCard, CompareCards, DiagramFrame, FailureSignatures, FlowSteps, GuideSection, Misconceptions, Mono, PacketAnatomy, StateTransition, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { ExplainIt, KnowledgeCheck, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { executeCli } from "@/lib/cli/parser";
import type { CliVendor } from "@/lib/cli/types";
import { createArpNet, planArp, type ArpNetState } from "@/lib/sim-engine/scenarios/arpNet";
import { ADDR, DEVICE_HOSTNAME, SUBNETS } from "@/lib/sim-engine/scenarios/firstConnection";
import { type FirstConnectionCliDevice } from "@/components/connection-network/cliAdapter";
import { arpR1Sets, arpSwSets, type ArpCliApi } from "./arp-lab/arpNetCli";
import { C } from "@/components/connection-network/guideSvg";

/**
 * ARP DEEP DIVE — the complete ARP lesson, taught on ONE network: the
 * exact Laptop / SW1 / R1 / Server topology of the guided lesson and the
 * ARP Lab. Every address comes from firstConnection.ts, and every CLI
 * sample below is generated from the ARP Lab model through the real CLI
 * adapter, so the guide, the lesson and the lab cannot drift apart.
 *
 * Progression: Foundation → The exchange → Using the result →
 * Operations → Advanced (optional) → Master it.
 */

const G = { foundation: "Foundation", exchange: "The exchange", using: "Using the result", ops: "Operations", advanced: "Advanced", master: "Master it" };

export const ARP_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "d-problem", label: "The problem ARP solves", group: G.foundation },
  { id: "d-local-remote", label: "Local or remote?", group: G.foundation },
  { id: "d-next-hop", label: "What the Laptop needs", group: G.foundation },
  { id: "d-request", label: "ARP Request anatomy", group: G.exchange },
  { id: "d-switch", label: "What the switch does", group: G.exchange },
  { id: "d-domain", label: "The broadcast domain", group: G.exchange },
  { id: "d-router", label: "What the router does", group: G.exchange },
  { id: "d-reply", label: "ARP Reply anatomy", group: G.exchange },
  { id: "d-reply-switch", label: "Flood → unicast → known", group: G.exchange },
  { id: "d-learned", label: "Three devices, three facts", group: G.exchange },
  { id: "d-arp-vs-mac", label: "ARP table vs MAC table", group: G.exchange },
  { id: "d-frame", label: "Build the real frame", group: G.using },
  { id: "d-second-hop", label: "At the router: ARP is hop-local", group: G.using },
  { id: "d-local", label: "Local vs remote destination", group: G.using },
  { id: "d-cache", label: "ARP cache and reuse", group: G.using },
  { id: "d-cli", label: "Cisco and Juniper CLI", group: G.ops },
  { id: "d-before-after", label: "Before and after, on the CLI", group: G.ops },
  { id: "d-troubleshoot", label: "Troubleshooting step by step", group: G.ops },
  { id: "d-failures", label: "Failure signatures", group: G.ops },
  { id: "d-myths", label: "Common misconceptions", group: G.ops },
  { id: "d-gratuitous", label: "Gratuitous ARP", group: G.advanced },
  { id: "d-proxy", label: "Proxy ARP", group: G.advanced },
  { id: "d-security", label: "ARP security", group: G.advanced },
  { id: "d-ipv6", label: "IPv6 uses ND, not ARP", group: G.advanced },
  { id: "d-walk", label: "End-to-end packet walk", group: G.master },
  { id: "d-quiz", label: "Knowledge check", group: G.master },
  { id: "d-explain", label: "Can you explain it?", group: G.master },
  { id: "d-practice", label: "Practice in the ARP Lab", group: G.master },
];

// ------------------------------------------------------------------ network facts (one source)

const LAPTOP = ADDR.laptop;
const GW = ADDR.gateway;
const SERVER = ADDR.server;
const R1_SERVER_IP = ADDR.routerWan.ip;
const LOCAL_PEER = "192.168.10.20";
const SW = DEVICE_HOSTNAME.switch;
const R1 = DEVICE_HOSTNAME.router;

// The ARP Lab's own model and terminals drive the CLI samples: the Laptop pings the Server, and three moments of
// that exchange are shown — T0 before anything, T1 once the Request has been flooded, T2 once the Reply has arrived.
const LAB_PLAN = planArp(createArpNet(), { type: "ping", src: "laptop", dst: ADDR.server.ip, count: 1 });
const LAB_T0 = createArpNet();
const LAB_T1 = LAB_PLAN.snaps[2];
const LAB_T2 = LAB_PLAN.snaps[4];

function cliOutput(state: ArpNetState, device: FirstConnectionCliDevice, vendor: CliVendor, command: string) {
  const api: ArpCliApi = { view: state, act: () => state, sw: { cisco: { kind: "exec" }, setCisco: () => undefined, junosEdit: false, setJunosEdit: () => undefined, cand: [], setCand: () => undefined } };
  const set = (device === "router" ? arpR1Sets(api) : arpSwSets(api))[vendor];
  const r = executeCli(set, command);
  return { prompt: set.prompt, output: r.kind === "ok" ? r.output : "" };
}

// ------------------------------------------------------------------ local visual helpers

const Strong = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;

/** Lesson-local SVG device with text sizes chosen to stay readable when the figure scrolls on phones. */
function Node({ x, y, label, sub, accent = C.cyan, w = 108, dim }: { x: number; y: number; label: string; sub?: string; accent?: string; w?: number; dim?: boolean }) {
  return (
    <g opacity={dim ? 0.45 : 1}>
      <rect x={x - w / 2} y={y - 25} width={w} height={50} rx={10} fill={C.box} stroke={accent} strokeOpacity={0.8} strokeWidth={1.5} />
      <text x={x} y={sub ? y - 3 : y + 5} textAnchor="middle" fill={C.text} fontSize={13.5} fontWeight={700}>
        {label}
      </text>
      {sub && (
        <text x={x} y={y + 15} textAnchor="middle" fill={C.muted} fontSize={11} fontFamily="monospace">
          {sub}
        </text>
      )}
    </g>
  );
}

function Arrowhead({ id, color }: { id: string; color: string }) {
  return (
    <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill={color} />
    </marker>
  );
}

/** Wide diagrams keep readable text by scrolling inside their frame on narrow screens instead of shrinking. */
function WideSvg({ h, label, children }: { h: number; label: string; children: ReactNode }) {
  return (
    <div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 640 ${h}`} className="h-auto w-full min-w-[540px]" role="img" aria-label={label}>
          {children}
        </svg>
      </div>
      <p className="pt-1 text-center text-[10.5px] text-pv-text-faint sm:hidden" aria-hidden>
        ← swipe to see the whole diagram →
      </p>
    </div>
  );
}

function Box({ tone, title, children, className = "" }: { tone: string; title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border p-3 ${className}`} style={{ borderColor: `${tone}55`, background: `${tone}0d` }}>
      {title && (
        <p className="mb-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: tone }}>
          {title}
        </p>
      )}
      <div className="text-xs leading-relaxed text-pv-text-muted">{children}</div>
    </div>
  );
}

function CliPanel({ prompt, command, output }: { prompt: string; command: string; output: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-[#05080d]">
      <pre className="overflow-x-auto px-3 py-2 pv-mono text-[10.5px] leading-relaxed text-pv-text-muted">
        <span className="text-pv-success">{prompt}</span>
        <span className="text-pv-text">{command}</span>
        {"\n"}
        {output}
      </pre>
    </div>
  );
}

// ------------------------------------------------------------------ diagrams

function ProblemDiagram() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Box tone={C.cyan} title="What the Laptop knows">
        <ul className="space-y-1">
          <li>
            Its own address: <Mono>{LAPTOP.ip}/24</Mono>
          </li>
          <li>
            Its own MAC: <Mono>{LAPTOP.mac}</Mono>
          </li>
          <li>
            Its default gateway: <Mono>{GW.ip}</Mono>
          </li>
          <li>
            The destination: <Mono>{SERVER.ip}</Mono>
          </li>
        </ul>
      </Box>
      <Box tone={C.arp} title="The first Ethernet frame it must build">
        <div className="space-y-1.5 pv-mono text-[11px]">
          <div className="flex justify-between gap-2 rounded border border-white/10 px-2 py-1">
            <span className="text-pv-text-faint">Source MAC</span>
            <span className="text-pv-text">{LAPTOP.mac}</span>
          </div>
          <div className="flex justify-between gap-2 rounded border px-2 py-1" style={{ borderColor: C.arp, background: `${C.arp}1a` }}>
            <span style={{ color: C.arp }}>Destination MAC</span>
            <span className="font-bold" style={{ color: C.arp }}>
              ??:??:??:??:??:??
            </span>
          </div>
          <div className="flex justify-between gap-2 rounded border border-white/10 px-2 py-1">
            <span className="text-pv-text-faint">IPv4 destination</span>
            <span className="text-pv-text">{SERVER.ip}</span>
          </div>
        </div>
        <p className="mt-2">Ethernet cannot deliver a frame to an IP address. It needs a destination MAC — and nothing the Laptop knows provides one.</p>
      </Box>
    </div>
  );
}

function SubnetRow({ who, ip, net, host, tone }: { who: string; ip: string; net: string; host: string; tone: string }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[7rem_10rem_minmax(0,1fr)]">
      <span className="text-[11px] font-semibold text-pv-text">{who}</span>
      <span className="hidden pv-mono text-[11px] text-pv-text-muted sm:inline">{ip}</span>
      <span className="pv-mono text-xs">
        <span className="rounded-l px-1.5 py-0.5" style={{ background: `${tone}26`, color: tone }}>
          {net}
        </span>
        <span className="rounded-r bg-white/5 px-1.5 py-0.5 text-pv-text-faint">.{host}</span>
      </span>
    </div>
  );
}

function SubnetMath() {
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-pv-text-faint">
        With a <Mono>/24</Mono> prefix the first three octets are the <span style={{ color: C.cyan }}>network part</span>; the last octet is the host part.
      </p>
      <SubnetRow who="Laptop" ip={`${LAPTOP.ip}/24`} net="192.168.10" host="10" tone={C.cyan} />
      <SubnetRow who="PC-B" ip={LOCAL_PEER} net="192.168.10" host="20" tone={C.cyan} />
      <SubnetRow who="Server" ip={SERVER.ip} net="10.20.20" host="20" tone={C.danger} />
      <div className="grid gap-2 pt-1 sm:grid-cols-2">
        <Box tone={C.tcp} title={`${LOCAL_PEER} → same network`}>
          Network part matches <Mono>192.168.10</Mono> → <Strong>local</Strong>. Deliver directly on this link.
        </Box>
        <Box tone={C.danger} title={`${SERVER.ip} → different network`}>
          <Mono>10.20.20</Mono> ≠ <Mono>192.168.10</Mono> → <Strong>remote</Strong>. Hand the packet to the default gateway.
        </Box>
      </div>
    </div>
  );
}

function DecisionTree() {
  const box = "rounded-lg border px-3 py-2 text-center text-xs text-pv-text";
  return (
    <div className="flex flex-col items-center gap-1.5 py-1">
      <div className={box} style={{ borderColor: C.ip }}>
        Destination IP
      </div>
      <span className="text-pv-text-faint">↓</span>
      <div className={box} style={{ borderColor: C.cyan }}>
        Is the destination on my local subnet?
      </div>
      <div className="grid w-full max-w-xl grid-cols-2 gap-3 pt-1">
        <div className="flex flex-col items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase" style={{ color: C.tcp }}>
            Yes — local
          </span>
          <div className={box} style={{ borderColor: C.tcp }}>
            ARP for the <Strong>destination itself</Strong>
          </div>
          <span className="pv-mono text-[10.5px] text-pv-text-faint">e.g. {LOCAL_PEER}</span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase" style={{ color: C.arp }}>
            No — remote
          </span>
          <div className={box} style={{ borderColor: C.arp }}>
            Route lookup → default gateway
          </div>
          <span className="text-pv-text-faint">↓</span>
          <div className={box} style={{ borderColor: C.arp }}>
            ARP for the <Strong>next-hop IP</Strong>
          </div>
          <span className="pv-mono text-[10.5px] text-pv-text-faint">
            {SERVER.ip} → ARP for {GW.ip}
          </span>
        </div>
      </div>
    </div>
  );
}

function FinalVsNextHop() {
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <Box tone={C.ip} title="Final Layer-3 destination">
          <p className="pv-mono text-base text-pv-text">{SERVER.ip}</p>
          <p>The Server. Carried in the IPv4 header, unchanged end to end.</p>
        </Box>
        <Box tone={C.arp} title="Local Layer-2 next hop">
          <p className="pv-mono text-base text-pv-text">{GW.ip}</p>
          <p>The Router. Only needed to fill in the Ethernet header on this link.</p>
        </Box>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-white/10 px-3 py-2 pv-mono text-[11px]">
          <span className="text-pv-text-faint">IPv4 destination = </span>
          <span style={{ color: C.ip }}>{SERVER.ip}</span>
        </div>
        <div className="rounded-lg border border-white/10 px-3 py-2 pv-mono text-[11px]">
          <span className="text-pv-text-faint">Ethernet destination = </span>
          <span style={{ color: C.arp }}>{GW.mac}</span>
          <span className="text-pv-text-faint"> (after ARP)</span>
        </div>
      </div>
    </div>
  );
}

function HumanVsWire({ kind }: { kind: "request" | "reply" }) {
  const req = kind === "request";
  const pairs: [string, string, string][] = req
    ? [
        ["Everyone on 192.168.10.0/24…", "Ethernet destination", "FF:FF:FF:FF:FF:FF"],
        [`who owns ${GW.ip}?`, "Target IP", GW.ip],
        [`I am ${LAPTOP.ip}`, "Sender IP", LAPTOP.ip],
        [`at MAC ${LAPTOP.mac}.`, "Sender MAC", LAPTOP.mac],
      ]
    : [
        [`${GW.ip} is me.`, "Sender IP", GW.ip],
        [`My MAC is ${GW.mac}.`, "Sender MAC", GW.mac],
        [`(Just to you, ${LAPTOP.ip}.)`, "Ethernet dst · Target MAC", LAPTOP.mac],
      ];
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="rounded-2xl rounded-bl-sm border p-3 text-sm italic text-pv-text" style={{ borderColor: `${C.arp}66`, background: `${C.arp}10` }}>
        <p className="mb-1 text-[10px] font-bold not-italic uppercase tracking-wide" style={{ color: C.arp }}>
          In plain words — {req ? "the Laptop" : "R1"} says
        </p>
        “{pairs.map((p) => p[0]).join(" ")}”
      </div>
      <ul className="space-y-1">
        {pairs.map(([human, field, value]) => (
          <li key={field} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-white/10 px-2.5 py-1 text-[11px]">
            <span className="text-pv-text-muted">
              “{human}” <span className="text-pv-text-faint">→</span> <span className="font-semibold text-pv-text">{field}</span>
            </span>
            <span className="pv-mono" style={{ color: C.arp }}>
              {value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SwitchSteps() {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <Box tone={C.eth} title="1 · Frame arrives on Fa0/1">
        Source MAC <Mono>{LAPTOP.mac}</Mono>, destination <Mono>FF:FF:FF:FF:FF:FF</Mono>. {SW} doesn’t open the ARP payload.
      </Box>
      <Box tone={C.tcp} title="2 · Learn the source">
        Ethernet rule: remember where each source MAC lives.
        <div className="mt-1.5 rounded border border-white/10 px-2 py-1 pv-mono text-[11px] text-pv-text">
          + {LAPTOP.mac} → Fa0/1
        </div>
      </Box>
      <Box tone={C.arp} title="3 · Check the destination">
        <Mono>FF:FF:FF:FF:FF:FF</Mono> is broadcast → flood out every other port in the VLAN. Here that is <Mono>Fa0/2</Mono>, toward R1.
      </Box>
    </div>
  );
}

function BroadcastDomainSvg() {
  return (
    <WideSvg h={220} label="The ARP Request floods the 192.168.10.0/24 broadcast domain from the Laptop through SW1 to R1 and is not forwarded onto 10.20.20.0/24">
      <defs>
        <Arrowhead id="bd-arp" color={C.arp} />
      </defs>
      <rect x={8} y={26} width={432} height={160} rx={14} fill={C.arp} fillOpacity={0.06} stroke={C.arp} strokeOpacity={0.55} strokeDasharray="6 5" />
      <rect x={440} y={26} width={192} height={160} rx={14} fill={C.tcp} fillOpacity={0.04} stroke={C.tcp} strokeOpacity={0.35} strokeDasharray="6 5" />
      <text x={22} y={46} fill={C.arp} fontSize={12} fontWeight={700}>
        BROADCAST DOMAIN · {SUBNETS.lan.network}
      </text>
      <text x={618} y={46} textAnchor="end" fill={C.tcp} fontSize={12} fontWeight={700}>
        {SUBNETS.server.network}
      </text>
      <line x1={440} y1={20} x2={440} y2={192} stroke={C.text} strokeOpacity={0.35} strokeDasharray="3 4" />
      <Node x={66} y={112} label="Laptop" sub={LAPTOP.ip} w={104} />
      <Node x={240} y={112} label={SW} sub="Access Switch" accent={C.eth} w={104} />
      <Node x={440} y={112} label={R1} sub={GW.ip} accent={C.ip} w={104} />
      <Node x={578} y={112} label="Server" sub={SERVER.ip} accent={C.tcp} w={92} dim />
      <line x1={120} y1={112} x2={186} y2={112} stroke={C.arp} strokeWidth={2.4} markerEnd="url(#bd-arp)" />
      <line x1={294} y1={112} x2={386} y2={112} stroke={C.arp} strokeWidth={2.4} markerEnd="url(#bd-arp)" />
      <text x={153} y={102} textAnchor="middle" fill={C.arp} fontSize={11} fontWeight={700}>
        1
      </text>
      <text x={340} y={102} textAnchor="middle" fill={C.arp} fontSize={11} fontWeight={700}>
        2 · flood
      </text>
      <line x1={494} y1={112} x2={530} y2={112} stroke={C.faint} strokeWidth={2} strokeDasharray="4 4" />
      <text x={512} y={150} textAnchor="middle" fill={C.danger} fontSize={12} fontWeight={700}>
        ✕ not forwarded
      </text>
      <text x={240} y={172} textAnchor="middle" fill={C.muted} fontSize={11}>
        a switch extends the broadcast domain
      </text>
      <text x={440} y={208} textAnchor="middle" fill={C.muted} fontSize={11}>
        a router terminates it
      </text>
    </WideSvg>
  );
}

function ThreeFacts() {
  const card = (who: string, tone: string, rows: string[], kind: string, purpose: string) => (
    <div className="rounded-xl border p-3" style={{ borderColor: `${tone}66`, background: `${tone}0f` }}>
      <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: tone }}>
        {who}
      </p>
      <ul className="mt-1 space-y-0.5 pv-mono text-[11px] text-pv-text">
        {rows.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <p className="mt-2 pv-mono text-[10.5px] font-bold" style={{ color: tone }}>
        {kind}
      </p>
      <p className="text-[11px] text-pv-text-muted">{purpose}</p>
    </div>
  );
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {card("Laptop ARP cache", C.cyan, [`${GW.ip} → ${GW.mac}`], "IP → MAC", "Learned from the ARP Reply’s payload.")}
      {card(`${R1} ARP cache`, C.ip, [`${LAPTOP.ip} → ${LAPTOP.mac}`], "IP → MAC", "Learned from the ARP Request’s sender fields.")}
      {card(`${SW} MAC table`, C.eth, [`${LAPTOP.mac} → Fa0/1`, `${GW.mac} → Fa0/2`], "MAC → PORT", "Learned from the source MAC of each frame entering a port.")}
    </div>
  );
}

function ChainLookup() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
      <span className="rounded-lg border px-2.5 py-1.5 pv-mono text-pv-text" style={{ borderColor: C.ip }}>
        {GW.ip}
      </span>
      <span className="text-center text-[10px] font-bold uppercase" style={{ color: C.cyan }}>
        Laptop ARP
        <br />→
      </span>
      <span className="rounded-lg border px-2.5 py-1.5 pv-mono text-pv-text" style={{ borderColor: C.arp }}>
        {GW.mac}
      </span>
      <span className="text-center text-[10px] font-bold uppercase" style={{ color: C.eth }}>
        {SW} MAC table
        <br />→
      </span>
      <span className="rounded-lg border px-2.5 py-1.5 pv-mono text-pv-text" style={{ borderColor: C.eth }}>
        Fa0/2
      </span>
    </div>
  );
}

function RealFrame() {
  const cell = (label: string, value: string, note: string, tone: string, strong?: boolean) => (
    <div className="flex-1 rounded-lg border p-2.5" style={{ borderColor: `${tone}66`, background: strong ? `${tone}14` : "transparent" }}>
      <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: tone }}>
        {label}
      </p>
      <p className="pv-mono mt-0.5 text-xs text-pv-text">{value}</p>
      <p className="mt-1 text-[10.5px] text-pv-text-faint">{note}</p>
    </div>
  );
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-xl border border-white/10 p-2 sm:flex-row" style={{ background: `${C.eth}0d` }}>
          {cell("Ethernet src", LAPTOP.mac, "the Laptop", C.eth)}
          {cell("Ethernet dst", GW.mac, "NEXT HOP: R1 (from ARP)", C.arp, true)}
        </div>
        <div className="flex flex-col gap-2 rounded-xl border border-white/10 p-2 sm:flex-row" style={{ background: `${C.ip}0d` }}>
          {cell("IPv4 src", LAPTOP.ip, "the Laptop", C.ip)}
          {cell("IPv4 dst", SERVER.ip, "FINAL DESTINATION: the Server", C.ip, true)}
        </div>
      </div>
      <Box tone={C.eth} title={`${SW} forwards it`}>
        {SW} reads only the Ethernet destination <Mono>{GW.mac}</Mono>. Its MAC table says <Mono>{GW.mac} → Fa0/2</Mono>, so the frame leaves Fa0/2 only — <Strong>known unicast</Strong>, no flooding.
      </Box>
    </div>
  );
}

function SecondHopSvg() {
  return (
    <WideSvg h={250} label="Two separate broadcast domains: ARP 1 between the Laptop and R1 on the LAN, ARP 2 between R1 and the Server on the server segment, only if R1 has no cached entry">
      <defs>
        <Arrowhead id="sh-arp" color={C.arp} />
        <Arrowhead id="sh-ip" color={C.ip} />
      </defs>
      <rect x={8} y={44} width={322} height={132} rx={14} fill={C.cyan} fillOpacity={0.04} stroke={C.cyan} strokeOpacity={0.35} strokeDasharray="6 5" />
      <rect x={330} y={44} width={302} height={132} rx={14} fill={C.tcp} fillOpacity={0.04} stroke={C.tcp} strokeOpacity={0.35} strokeDasharray="6 5" />
      <text x={20} y={62} fill={C.cyan} fontSize={11.5} fontWeight={700}>
        {SUBNETS.lan.network}
      </text>
      <text x={620} y={62} textAnchor="end" fill={C.tcp} fontSize={11.5} fontWeight={700}>
        {SUBNETS.server.network}
      </text>
      <Node x={70} y={118} label="Laptop" sub={LAPTOP.ip} w={100} />
      <Node x={180} y={118} label={SW} accent={C.eth} w={76} />
      <Node x={330} y={118} label={R1} sub={`${GW.ip} | ${R1_SERVER_IP}`} accent={C.ip} w={196} />
      <Node x={560} y={118} label="Server" sub={SERVER.ip} accent={C.tcp} w={104} />
      <line x1={120} y1={118} x2={142} y2={118} stroke={C.line} strokeWidth={2} />
      <line x1={218} y1={118} x2={232} y2={118} stroke={C.line} strokeWidth={2} />
      <line x1={428} y1={118} x2={508} y2={118} stroke={C.line} strokeWidth={2} />
      <line x1={70} y1={26} x2={318} y2={26} stroke={C.arp} strokeWidth={2} markerStart="url(#sh-arp)" markerEnd="url(#sh-arp)" />
      <text x={194} y={20} textAnchor="middle" fill={C.arp} fontSize={11} fontWeight={700}>
        ARP #1 · Laptop ↔ R1 ({GW.ip})
      </text>
      <line x1={342} y1={26} x2={560} y2={26} stroke={C.arp} strokeWidth={2} strokeDasharray="5 4" markerStart="url(#sh-arp)" markerEnd="url(#sh-arp)" />
      <text x={451} y={20} textAnchor="middle" fill={C.arp} fontSize={11} fontWeight={700}>
        ARP #2 · R1 ↔ Server — only if not cached
      </text>
      <line x1={70} y1={200} x2={556} y2={200} stroke={C.ip} strokeWidth={2.2} markerEnd="url(#sh-ip)" />
      <text x={313} y={194} textAnchor="middle" fill={C.ip} fontSize={11} fontWeight={700}>
        IPv4 {LAPTOP.ip} → {SERVER.ip} (unchanged)
      </text>
      <text x={194} y={226} textAnchor="middle" fill={C.muted} fontSize={11} fontFamily="monospace">
        frame 1: dst MAC = {GW.mac}
      </text>
      <text x={470} y={226} textAnchor="middle" fill={C.muted} fontSize={11} fontFamily="monospace">
        frame 2: dst MAC = Server’s MAC
      </text>
    </WideSvg>
  );
}

function LocalVsRemote() {
  const rows: [string, string, string][] = [
    ["Destination", LOCAL_PEER, SERVER.ip],
    ["Same /24 as the Laptop?", "Yes", "No"],
    ["Next hop", "the destination itself", `default gateway ${GW.ip}`],
    ["ARP target", LOCAL_PEER, GW.ip],
    ["Ethernet dst of the data frame", `${LOCAL_PEER}’s MAC`, `${GW.mac} (R1)`],
    ["IPv4 dst of the data frame", LOCAL_PEER, SERVER.ip],
  ];
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full min-w-[460px] text-left text-xs">
        <thead className="bg-white/[0.03]">
          <tr>
            <th className="px-3 py-2 font-semibold text-pv-text-faint">
              <span className="sr-only">Property</span>
            </th>
            <th className="px-3 py-2 font-semibold" style={{ color: C.tcp }}>
              Local destination
            </th>
            <th className="px-3 py-2 font-semibold" style={{ color: C.arp }}>
              Remote destination
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map(([k, l, r]) => (
            <tr key={k}>
              <td className="px-3 py-2 text-pv-text">{k}</td>
              <td className="px-3 py-2 pv-mono text-[11px] text-pv-text-muted">{l}</td>
              <td className="px-3 py-2 pv-mono text-[11px] text-pv-text-muted">{r}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CliCompare({ device, question, lookFor, cisco, junos, state = LAB_T2 }: { device: FirstConnectionCliDevice; question: string; lookFor: string; cisco: string; junos: string; state?: ArpNetState }) {
  const c = cliOutput(state, device, "cisco", cisco);
  const j = cliOutput(state, device, "juniper", junos);
  return (
    <div className="space-y-2 rounded-xl border border-white/10 p-3">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-pv-cyan-soft">Engineering question</p>
        <p className="text-sm font-semibold text-pv-text">{question}</p>
        <p className="mt-0.5 text-xs text-pv-text-muted">
          <span className="text-pv-text-faint">Look for: </span>
          {lookFor}
        </p>
        <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span>
            <span className="text-pv-text-faint">Cisco </span>
            <span className="pv-mono text-pv-text">{cisco}</span>
          </span>
          <span>
            <span className="text-pv-text-faint">Junos </span>
            <span className="pv-mono text-pv-text">{junos}</span>
          </span>
        </p>
      </div>
      <div className="grid gap-2">
        <div className="min-w-0">
          <p className="mb-1 text-[10px] font-bold uppercase text-pv-text-faint">Cisco IOS</p>
          <CliPanel prompt={c.prompt} command={cisco} output={c.output} />
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-[10px] font-bold uppercase text-pv-text-faint">Juniper Junos</p>
          <CliPanel prompt={j.prompt} command={junos} output={j.output} />
        </div>
      </div>
    </div>
  );
}

function BeforeAfter() {
  const fmt = (rows: ArpNetState["caches"]["laptop"]) => rows.filter((e) => e.state === "reachable").map((e) => `${e.ip} → ${e.mac}`);
  const col = (title: string, tone: string, s: ArpNetState) => (
    <div className="rounded-xl border p-3" style={{ borderColor: `${tone}55` }}>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: tone }}>
        {title}
      </p>
      {(
        [
          [`${SW} MAC`, Object.entries(s.swMac).map(([m, e]) => `${m} → Fa0/${e.port.slice(2)}`)],
          [`${R1} ARP`, fmt(s.caches.r1)],
          ["Laptop ARP", fmt(s.caches.laptop)],
        ] as [string, string[]][]
      ).map(([name, rows]) => (
        <div key={name} className="mb-1.5 last:mb-0">
          <p className="text-[10.5px] font-semibold text-pv-text">{name}</p>
          {rows.length ? (
            rows.map((r) => (
              <p key={r} className="pv-mono text-[10.5px] text-pv-text-muted">
                {r}
              </p>
            ))
          ) : (
            <p className="pv-mono text-[10.5px] text-pv-text-faint">EMPTY</p>
          )}
        </div>
      ))}
    </div>
  );
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {col("T0 · Before ARP", C.muted, LAB_T0)}
      {col("T1 · After the Request", C.arp, LAB_T1)}
      {col("T2 · After the Reply", C.tcp, LAB_T2)}
    </div>
  );
}

function TroubleshootFlow() {
  const steps: [string, string][] = [
    ["Is my IP address and prefix correct?", `Host settings: ${LAPTOP.ip}/24, gateway ${GW.ip}. A wrong mask changes the local/remote decision.`],
    ["Is the target local or remote?", "Compare network parts. Remote → the next hop is the gateway."],
    ["Which IP should I ARP for?", "The destination if local, the next hop (gateway) if remote."],
    ["Do I already have an ARP entry?", "The host’s ARP cache (e.g. arp -a). A wrong or stale entry is as bad as none."],
    ["Is an ARP Request leaving?", "Packet capture on the host or a mirror port. Is the interface up?"],
    ["Does the switch learn my source MAC?", `${SW}: show mac address-table / show ethernet-switching table — is the MAC on the expected port and VLAN?`],
    ["Does the request reach the target?", "Same VLAN? Target port up? Capture on the target side."],
    ["Does the target respond?", `${R1}: show ip arp / show arp — did it learn the requester? Is ${GW.ip} really configured on that interface?`],
    ["Does the reply return?", "Return path: the switch should forward it as known unicast toward the requester."],
    ["Does my ARP cache update?", `The host now maps ${GW.ip} → ${GW.mac}.`],
    ["Can I now build and send the frame?", "If ARP works but traffic still fails, the problem is above Layer 2 — keep going up the stack."],
  ];
  return <TroubleshootingFlow steps={steps.map(([question, look]) => ({ question, look }))} />;
}

function FailureCards() {
  return (
    <FailureSignatures
      items={[
        { tag: "A", title: "No ARP Request leaves", tone: "danger", points: ["Host addressing, prefix or routing decision", "Interface down or disabled", "An existing (possibly wrong) cache entry is used instead"] },
        { tag: "B", title: "Request leaves, no reply", tone: "arp", points: ["Wrong VLAN or a broken Layer-2 path", "Target down or not present", "Requesting the wrong target IP", "Security/filtering dropping it"] },
        { tag: "C", title: "Reply sent, host never gets it", tone: "violet", points: ["Layer-2 return path or switching state", "Filtering or security features on the return path"] },
        { tag: "D", title: "ARP entry exists, traffic still fails", tone: "ip", points: ["ARP only proves local Layer-2 neighbor resolution", "Next suspects: routing, firewall, TCP/UDP, the application"] },
      ]}
    />
  );
}

function Myths() {
  const items: [string, ReactNode][] = [
    ["ARP finds the destination MAC for every IP packet.", <>ARP resolves the local <Strong>next-hop</Strong> IPv4 neighbor. For a remote destination that is normally the gateway.</>],
    ["Switches use ARP to forward frames.", <>Switches forward with their <Strong>MAC table</Strong>. A pure Layer-2 switch needs no ARP entry to forward.</>],
    ["An ARP Request travels through routers.", <>Ordinary Ethernet broadcasts stay inside their <Strong>broadcast domain</Strong>. R1 terminates it.</>],
    ["If ARP works, the application must work.", <>ARP only establishes local Layer-2 neighbor resolution. Routing, firewalls, transport and the application can still fail.</>],
    ["The destination IP changes to the gateway IP.", <>The IPv4 destination stays the <Strong>Server</Strong>. Only the Ethernet destination uses the gateway’s MAC.</>],
    ["IPv6 uses ARP too.", <>IPv6 uses <Strong>Neighbor Discovery</Strong> (ICMPv6) instead.</>],
  ];
  return <Misconceptions items={items.map(([myth, correction]) => ({ myth, correction }))} />;
}

// ------------------------------------------------------------------ questions

const Q = {
  localRemote: {
    id: "p-local",
    prompt: <>The Laptop is {LAPTOP.ip}/24. Is {SERVER.ip} local or remote?</>,
    options: [
      { id: "local", label: "Local — same network" },
      { id: "remote", label: "Remote — different network" },
    ],
    correctId: "remote",
    explanation: <>The network part 10.20.20 differs from 192.168.10, so the Server is remote and the next hop is the gateway {GW.ip}.</>,
  },
  requestDst: {
    id: "p-req-dst",
    prompt: "What Ethernet destination should an ARP Request use?",
    options: [
      { id: "gw", label: GW.mac },
      { id: "bcast", label: "FF:FF:FF:FF:FF:FF (broadcast)" },
      { id: "server", label: "The Server’s MAC" },
      { id: "zero", label: "00:00:00:00:00:00" },
    ],
    correctId: "bcast",
    explanation: <>The Laptop doesn’t know which MAC owns {GW.ip} yet — that’s the question. So it asks everyone on the segment with a broadcast.</>,
  },
  switchFirst: {
    id: "p-sw-first",
    prompt: `The Request enters ${SW} on Fa0/1. What does ${SW} learn first?`,
    options: [
      { id: "src", label: `${LAPTOP.mac} → Fa0/1` },
      { id: "arp", label: `${GW.ip} → ${GW.mac}` },
      { id: "dst", label: "FF:FF:FF:FF:FF:FF → Fa0/2" },
      { id: "none", label: "Nothing — it waits for the reply" },
    ],
    correctId: "src",
    explanation: <>A switch learns the SOURCE MAC of every frame on ingress. It doesn’t need the reply — or ARP at all — to do that.</>,
  },
  replyCast: {
    id: "p-reply",
    prompt: "Will R1’s ARP Reply be broadcast or unicast?",
    options: [
      { id: "b", label: "Broadcast, like the request" },
      { id: "u", label: `Unicast, to ${LAPTOP.mac}` },
    ],
    correctId: "u",
    explanation: <>The request already told R1 who asked (sender IP and MAC), so R1 can answer that one device directly.</>,
  },
  framePair: {
    id: "p-frame",
    prompt: `The first data frame to ${SERVER.ip} — which pair is correct?`,
    options: [
      { id: "a", label: "A · MAC = Server, IP = Server" },
      { id: "b", label: "B · MAC = Router, IP = Server" },
    ],
    correctId: "b",
    explanation: <>The MAC destination is the next hop on this link (R1). The IP destination is the final endpoint (the Server).</>,
  },
} satisfies Record<string, KnowledgeQuestion>;

const QUIZ: KnowledgeQuestion[] = [
  { id: "k1", prompt: <>The Laptop ({LAPTOP.ip}/24) wants to reach {LOCAL_PEER}. Which IP does it ARP for?</>, options: [{ id: "peer", label: LOCAL_PEER }, { id: "gw", label: GW.ip }, { id: "self", label: LAPTOP.ip }, { id: "b", label: "255.255.255.255" }], correctId: "peer", explanation: <>{LOCAL_PEER} is on the same /24, so it’s a local neighbor: ARP for it directly, no gateway involved.</> },
  { id: "k2", prompt: <>It now wants {SERVER.ip}. Which IP does it ARP for?</>, options: [{ id: "srv", label: SERVER.ip }, { id: "gw", label: GW.ip }, { id: "r1s", label: R1_SERVER_IP }, { id: "none", label: "No ARP is needed" }], correctId: "gw", explanation: <>Remote destination → next hop is the default gateway {GW.ip}. The Laptop never ARPs for an off-subnet address.</> },
  { id: "k3", prompt: "In the ARP Request, why is the Target MAC 00:00:00:00:00:00?", options: [{ id: "u", label: "It is unknown — that is what ARP is asking" }, { id: "b", label: "It means broadcast" }, { id: "e", label: "It is an error value" }, { id: "s", label: "It is the switch’s MAC" }], correctId: "u", explanation: "The whole point of the request is that the sender doesn’t know the target’s MAC yet. Broadcast delivery is the job of the Ethernet destination, not this field." },
  { id: "k4", prompt: "What makes the ARP Request reach every device on the LAN?", options: [{ id: "eth", label: "Ethernet destination FF:FF:FF:FF:FF:FF" }, { id: "op", label: "ARP operation 1" }, { id: "tpa", label: "The Target IP field" }, { id: "router", label: "R1 forwards it" }], correctId: "eth", explanation: "Switches flood broadcast frames out every other port in the VLAN. ARP fields are only read by the receivers." },
  { id: "k5", prompt: `What does ${SW} learn from the ARP Reply entering Fa0/2?`, options: [{ id: "a", label: `${GW.mac} → Fa0/2` }, { id: "b", label: `${GW.ip} → ${GW.mac}` }, { id: "c", label: `${LAPTOP.mac} → Fa0/2` }, { id: "d", label: "Nothing" }], correctId: "a", explanation: "Source MAC learning again: the reply’s Ethernet source is R1’s MAC, arriving on Fa0/2. The IP-to-MAC mapping is for the Laptop’s ARP cache, not the switch." },
  { id: "k6", prompt: "Which table answers “which switch port leads to this MAC?”", options: [{ id: "mac", label: "The switch MAC (CAM) table" }, { id: "arp", label: "The ARP table" }, { id: "rt", label: "The routing table" }, { id: "dns", label: "The DNS cache" }], correctId: "mac", explanation: "MAC table: MAC → port (switches). ARP table: IPv4 → MAC (hosts and routers)." },
  { id: "k7", prompt: <>The Laptop sends its first packet to {SERVER.ip}. Ethernet destination / IPv4 destination?</>, options: [{ id: "a", label: `${GW.mac} / ${SERVER.ip}` }, { id: "b", label: `Server MAC / ${SERVER.ip}` }, { id: "c", label: `${GW.mac} / ${GW.ip}` }, { id: "d", label: `FF:FF:FF:FF:FF:FF / ${SERVER.ip}` }], correctId: "a", explanation: "Next-hop MAC, final-destination IP. The IP header never changes to the gateway’s address." },
  { id: "k8", prompt: "Does the Server receive the Laptop’s ARP Request for the gateway?", options: [{ id: "n", label: "No — R1 terminates the broadcast domain" }, { id: "y", label: "Yes — R1 floods it onward" }, { id: "s", label: "Only if the switch knows the Server" }], correctId: "n", explanation: `Routers don’t forward ordinary Layer-2 broadcasts into another subnet. The request stays in ${SUBNETS.lan.network}.` },
  { id: "k9", prompt: "The Laptop sends a second packet to the Server a moment later. Does it ARP again?", options: [{ id: "n", label: "Normally no — it reuses the cached gateway entry" }, { id: "y", label: "Yes, ARP runs for every packet" }, { id: "s", label: "Yes, but for the Server this time" }], correctId: "n", explanation: "Resolved mappings are cached and reused until they age out or are revalidated. Exact timers and states vary by operating system and vendor." },
  { id: "k10", prompt: "Which protocol does IPv6 use instead of ARP?", options: [{ id: "nd", label: "Neighbor Discovery (ICMPv6)" }, { id: "rarp", label: "RARP" }, { id: "arp6", label: "ARPv6" }, { id: "dhcp", label: "DHCPv6" }], correctId: "nd", explanation: "IPv6 resolves link-layer addresses with Neighbor Solicitation/Advertisement messages, carried in ICMPv6." },
  { id: "k11", prompt: "The Laptop has a correct ARP entry for its gateway, but the website still fails. What does that tell you?", options: [{ id: "up", label: "Local Layer-2 resolution works — look higher: routing, firewall, transport, application" }, { id: "arp", label: "ARP must be broken anyway" }, { id: "sw", label: "The switch is the problem" }], correctId: "up", explanation: "ARP proves only that the next hop on this link is reachable at Layer 2. Everything after R1 is a different question." },
];

// ------------------------------------------------------------------ the guide

export function ArpDeepDiveContent({ onOpenLab }: { onOpenLab?: () => void }) {
  const eth = "Ethernet II header";
  return (
    <>
      <Callout tone="cyan" title="One network, start to finish" icon="i">
        Everything in this guide uses the network from the lesson and the ARP Lab: Laptop <Mono>{LAPTOP.ip}/24</Mono> → {SW} → {R1} (<Mono>{GW.ip}</Mono> | <Mono>{R1_SERVER_IP}</Mono>) → Server <Mono>{SERVER.ip}</Mono>. The core ends at “ARP table vs MAC table”; sections marked <b>Advanced</b> are optional.
      </Callout>

      {/* ============================== FOUNDATION */}
      <GuideSection id="d-problem" eyebrow="Foundation" title="The problem ARP solves" tone="arp">
        <p>
          The Laptop wants to send a packet to the Server at <Mono>{SERVER.ip}</Mono>. Before a single bit leaves its network card, it must build an <Strong>Ethernet frame</Strong> — and an Ethernet frame is delivered by <Strong>MAC address</Strong>, not by IP address.
        </p>
        <DiagramFrame caption="Everything the Laptop knows is an IP address. The one field Ethernet requires — the destination MAC — is still blank.">
          <ProblemDiagram />
        </DiagramFrame>
        <Callout tone="arp" title="The question" icon="?">
          What MAC address should the Laptop put in the destination field of its first Ethernet frame?
        </Callout>
        <p>
          <Strong>ARP — the Address Resolution Protocol</Strong> — is the IPv4 mechanism that answers it. Given the IPv4 address of a device <em>on the same link</em>, ARP discovers that device’s MAC address. It sits between IPv4 (Layer 3) and Ethernet (Layer 2). To use it correctly, the Laptop must first decide <em>whose</em> MAC it actually needs.
        </p>
      </GuideSection>

      <GuideSection id="d-local-remote" eyebrow="Foundation · core mental model" title="First decision: local or remote?" tone="cyan">
        <KnowledgeCheck question={Q.localRemote} />
        <p>
          The Laptop compares the destination with its own network. Its address <Mono>{LAPTOP.ip}/24</Mono> means its network is <Mono>{SUBNETS.lan.network}</Mono>: any address starting <Mono>192.168.10.</Mono> is on the same link.
        </p>
        <DiagramFrame caption="The prefix splits each address into a network part and a host part. Matching network parts mean the same link.">
          <SubnetMath />
        </DiagramFrame>
        <p>
          <Mono>{SERVER.ip}</Mono> is <Strong>not</Strong> inside <Mono>{SUBNETS.lan.network}</Mono>. Therefore the destination is remote, therefore the next hop is the default gateway <Mono>{GW.ip}</Mono>, and therefore the ARP target is <Mono>{GW.ip}</Mono> — <Strong>not</Strong> <Mono>{SERVER.ip}</Mono>.
        </p>
        <DiagramFrame caption="The decision every IPv4 host makes before ARP. Memorise this one.">
          <DecisionTree />
        </DiagramFrame>
        <Callout tone="warning" title="Why never ARP for the Server?" icon="!">
          ARP works by broadcast, and broadcasts stay on the local link. The Server is behind R1 on another network: it would never even hear the question.
        </Callout>
      </GuideSection>

      <GuideSection id="d-next-hop" eyebrow="Foundation" title="What exactly does the Laptop need?" tone="cyan">
        <p>Two different “destinations” live in the same frame. Keeping them apart is the key to ARP:</p>
        <DiagramFrame caption="The IP packet is trying to reach the Server. The Ethernet frame is only trying to reach the next device on this local link.">
          <FinalVsNextHop />
        </DiagramFrame>
        <p>
          So the Laptop’s real question is narrower than “what is the Server’s MAC?”. It is: <Strong>“what MAC owns {GW.ip}, my next hop?”</Strong> It checks its ARP cache, finds no entry, and starts an ARP exchange.
        </p>
      </GuideSection>

      {/* ============================== THE EXCHANGE */}
      <GuideSection id="d-request" eyebrow="The exchange · step 1" title="ARP Request — frame and packet anatomy" tone="arp">
        <KnowledgeCheck question={Q.requestDst} />
        <p>The request has a plain-language meaning and an exact wire format. Learn both:</p>
        <HumanVsWire kind="request" />
        <PacketAnatomy
          title="ARP Request as it leaves the Laptop"
          layers={[
            {
              name: eth,
              tone: "ethernet",
              note: "read by every switch",
              fields: [
                { name: "Destination MAC", value: "FF:FF:FF:FF:FF:FF", why: "Broadcast: the sender doesn’t know which MAC owns the target IP, so every station on the segment must see the question.", key: true },
                { name: "Source MAC", value: LAPTOP.mac, why: "The Laptop’s own MAC. Switches learn it from here — and it’s where the reply will go." },
                { name: "EtherType", value: "0x0806", why: "Says “the payload is ARP”. (IPv4 packets use 0x0800.) ARP is not carried inside IP." },
              ],
            },
            {
              name: "ARP payload (28 bytes)",
              tone: "arp",
              note: "read by the receivers",
              fields: [
                { name: "Hardware type", value: "1 (Ethernet)", why: "What kind of link-layer address is being resolved." },
                { name: "Protocol type", value: "0x0800 (IPv4)", why: "What kind of address is being looked up. ARP is generic; here it maps IPv4 → Ethernet." },
                { name: "Hardware length", value: "6", why: "A MAC address is 6 bytes." },
                { name: "Protocol length", value: "4", why: "An IPv4 address is 4 bytes." },
                { name: "Operation", value: "1 (Request)", why: "A question. The answer will carry operation 2.", key: true },
                { name: "Sender MAC", value: LAPTOP.mac, why: "Who is asking — so the target can reply directly, and may cache it." },
                { name: "Sender IP", value: LAPTOP.ip, why: "The asker’s IPv4 address, paired with the MAC above." },
                { name: "Target MAC", value: "00:00:00:00:00:00", why: "Zero because it is unknown — finding it is the entire reason ARP exists.", key: true },
                { name: "Target IP", value: GW.ip, why: "The question itself: who owns this address? (The gateway, not the Server.)", key: true },
              ],
            },
          ]}
        />
      </GuideSection>

      <GuideSection id="d-switch" eyebrow="The exchange · step 2" title="What the switch does" tone="ethernet">
        <KnowledgeCheck question={Q.switchFirst} />
        <p>{SW} is a Layer-2 switch. It never needs to understand ARP. It does two pure-Ethernet things with every frame, in this order:</p>
        <DiagramFrame caption="Learn the source, then decide on the destination. The ARP payload is never consulted.">
          <SwitchSteps />
        </DiagramFrame>
        <Callout tone="cyan" title="Source MAC learning is Ethernet behavior" icon="i">
          {SW} learned <Mono>{LAPTOP.mac} → Fa0/1</Mono> because that was the frame’s <b>source MAC</b> — before any reply existed. A switch does <b>not</b> search an “ARP table” to forward: it uses its MAC (CAM) table, MAC → port.
        </Callout>
      </GuideSection>

      <GuideSection id="d-domain" eyebrow="The exchange" title="The broadcast domain: where the question can go" tone="arp">
        <DiagramFrame caption="Switch: extends the broadcast domain. Router: terminates it. The Server never receives the Laptop’s gateway ARP.">
          <BroadcastDomainSvg />
        </DiagramFrame>
        <p>
          Every device in <Mono>{SUBNETS.lan.network}</Mono> receives the request: {SW} floods it, and R1’s LAN interface hears it. R1 does <Strong>not</Strong> forward an ordinary Ethernet broadcast into another IP subnet, so nothing reaches <Mono>{SUBNETS.server.network}</Mono>.
        </p>
      </GuideSection>

      <GuideSection id="d-router" eyebrow="The exchange · step 3" title="What the router does with the request" tone="ip">
        <StateTransition
          states={[
            { label: "Receive", detail: <>Request arrives on R1’s LAN interface.</>, tone: "arp" },
            {
              label: "Check target IP",
              detail: (
                <>
                  Is <Mono>{GW.ip}</Mono> one of my interface addresses? <b>Yes.</b>
                </>
              ),
              tone: "ip",
            },
            { label: "Cache the sender", detail: <Mono>{`${LAPTOP.ip} → ${LAPTOP.mac}`}</Mono>, tone: "success" },
            { label: "Build a reply", detail: <>Operation 2, unicast to the asker.</>, tone: "arp" },
          ]}
        />
        <p>
          The request carries the asker’s sender IP and sender MAC, so R1 can learn <Mono>{LAPTOP.ip} → {LAPTOP.mac}</Mono> while processing it — it is about to send a frame to exactly that device. ARP learning is therefore often <Strong>bidirectional</Strong> during one exchange. (Whether and when a target caches the sender varies between implementations; R1 in this lesson does, as most routers do.)
        </p>
        <p className="text-xs text-pv-text-faint">Any other host on the LAN would compare the target IP with its own address, see it isn’t theirs, and ignore the request.</p>
      </GuideSection>

      <GuideSection id="d-reply" eyebrow="The exchange · step 4" title="ARP Reply — the answer comes back" tone="arp">
        <KnowledgeCheck question={Q.replyCast} />
        <HumanVsWire kind="reply" />
        <PacketAnatomy
          title="ARP Reply as it leaves R1"
          layers={[
            {
              name: eth,
              tone: "ethernet",
              fields: [
                { name: "Destination MAC", value: LAPTOP.mac, why: "Unicast: R1 already knows who asked, from the request’s sender fields.", key: true },
                { name: "Source MAC", value: GW.mac, why: `R1’s LAN MAC — which ${SW} will learn on Fa0/2.` },
                { name: "EtherType", value: "0x0806", why: "ARP again." },
              ],
            },
            {
              name: "ARP payload",
              tone: "arp",
              note: "hardware/protocol type and lengths as in the request",
              fields: [
                { name: "Operation", value: "2 (Reply)", why: "This is the answer.", key: true },
                { name: "Sender MAC", value: GW.mac, why: "THE ANSWER: the MAC that owns the sender IP below.", key: true },
                { name: "Sender IP", value: GW.ip, why: "The address that was asked about." },
                { name: "Target MAC", value: LAPTOP.mac, why: "Who the answer is for — copied from the request." },
                { name: "Target IP", value: LAPTOP.ip, why: "The asker’s IPv4 address." },
              ],
            },
          ]}
        />
      </GuideSection>

      <GuideSection id="d-reply-switch" eyebrow="The exchange · step 5" title="Broadcast, then unicast, then known unicast" tone="ethernet">
        <p>
          The reply enters {SW} on Fa0/2 with source MAC <Mono>{GW.mac}</Mono>, so {SW} learns <Mono>{GW.mac} → Fa0/2</Mono>. It already learned <Mono>{LAPTOP.mac} → Fa0/1</Mono> from the request, so the reply goes out Fa0/1 only.
        </p>
        <DiagramFrame caption="How the switch’s behavior changes as it learns: one broadcast, one unicast, then efficient known-unicast forwarding.">
          <StateTransition
            states={[
              { label: "ARP Request", detail: <>broadcast → <b>flood</b>. Learns the Laptop on Fa0/1.</>, tone: "arp" },
              { label: "ARP Reply", detail: <>unicast to the Laptop. Learns R1 on Fa0/2; forwards out Fa0/1 only.</>, tone: "ethernet" },
              { label: "Data traffic", detail: <>both MACs known → <b>known unicast</b>, one port, no flooding.</>, tone: "success" },
            ]}
          />
        </DiagramFrame>
        <p>
          When the reply reaches the Laptop, its ARP cache gains <Mono>{GW.ip} → {GW.mac}</Mono>. It did <Strong>not</Strong> learn anything about the Server: <Mono>{SERVER.ip}</Mono> is not local, and the Laptop never needs its MAC.
        </p>
        <PracticeBridge label="Practice this in the ARP Lab" onPractice={onOpenLab}>
          Send the Request and Reply yourself and watch {SW} and R1 learn, hop by hop.
        </PracticeBridge>
      </GuideSection>

      <GuideSection id="d-learned" eyebrow="The exchange · result" title="Three devices, three facts" tone="success">
        <DiagramFrame caption="The whole exchange in one picture: two ARP caches (IP → MAC) and one switch table (MAC → PORT).">
          <ThreeFacts />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="d-arp-vs-mac" eyebrow="The exchange · core" title="ARP table vs MAC table" tone="violet">
        <CompareCards
          items={[
            { title: "ARP table (cache)", tone: "arp", tag: "IPv4 → MAC", points: ["Question: what MAC owns this local IPv4 address?", "Kept by IPv4 hosts and routers", `Example: ${GW.ip} → ${GW.mac}`, "Filled by ARP"] },
            { title: "MAC (CAM) table", tone: "ethernet", tag: "MAC → port", points: ["Question: which local switch port reaches this MAC?", "Kept by Ethernet switches", `Example: ${GW.mac} → Fa0/2`, "Filled by source-MAC learning"] },
          ]}
        />
        <DiagramFrame caption="On this network they work as a chain: the Laptop’s ARP table produces a MAC; the switch’s MAC table turns that MAC into a port.">
          <ChainLookup />
        </DiagramFrame>
        <Callout tone="success" title="You now understand normal ARP" icon="✓">
          Everything after this point applies what you’ve learned. The sections marked <b>Advanced</b> are optional extras.
        </Callout>
        <PracticeBridge label="Inspect both tables in the ARP Lab" onPractice={onOpenLab}>
          Query <Mono>show ip arp</Mono> on R1 and <Mono>show mac address-table</Mono> on {SW} — same network, live.
        </PracticeBridge>
      </GuideSection>

      {/* ============================== USING THE RESULT */}
      <GuideSection id="d-frame" eyebrow="Using the result" title="Now build the real IP frame" tone="ip">
        <KnowledgeCheck question={Q.framePair} />
        <DiagramFrame caption="MAC destination = next hop. IP destination = final destination.">
          <RealFrame />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="d-second-hop" eyebrow="Using the result" title="At the router: ARP is hop-local" tone="ip">
        <FlowSteps
          steps={[
            { title: "R1 accepts the frame", body: <>The Ethernet destination <Mono>{GW.mac}</Mono> is its own MAC. It removes the Ethernet header.</>, tone: "arp" },
            { title: "Route lookup", body: <><Mono>{SERVER.ip}</Mono> matches the directly connected <Mono>{SUBNETS.server.network}</Mono>.</>, tone: "ip" },
            { title: "Needs a Layer-2 destination on that segment", body: <>If R1 already has the Server’s MAC cached, it uses it. If not, R1 runs a <b>new, separate ARP exchange</b> on <Mono>{SUBNETS.server.network}</Mono>.</>, tone: "arp" },
            { title: "Builds a new frame", body: "A new Ethernet header for the server segment; the IPv4 packet inside is the same (TTL decremented).", tone: "tcp" },
          ]}
        />
        <DiagramFrame caption="Two links, two broadcast domains, two independent ARP exchanges. ARP never resolves a MAC end-to-end across a router.">
          <SecondHopSvg />
        </DiagramFrame>
        <p className="text-xs text-pv-text-faint">The ARP Lab shows both exchanges: pause when the ping reaches R1 and watch R1’s own ARP for the Server on its other interface — a broadcast the Laptop never sees. In the guided lesson, R1 already holds the Server’s MAC in its cache when it forwards.</p>
      </GuideSection>

      <GuideSection id="d-local" eyebrow="Using the result" title="Local destination vs remote destination" tone="cyan">
        <p>
          Same Laptop, two destinations: PC-B (<Mono>{LOCAL_PEER}</Mono>) on the same LAN — it is in the ARP Lab — and the Server behind R1:
        </p>
        <LocalVsRemote />
        <Callout tone="cyan" title="The rule" icon="i">
          Local destination → the ARP target is the destination host. Remote destination → the ARP target is the next-hop router.
        </Callout>
      </GuideSection>

      <GuideSection id="d-cache" eyebrow="Using the result" title="ARP cache and reuse" tone="success">
        <p>Broadcasting before every packet would be wasteful, so resolved mappings are cached and reused:</p>
        <StateTransition
          states={[
            { label: "No entry", detail: "first packet needs ARP", tone: "warning" },
            { label: "Resolving", detail: "request sent, packet held or queued", tone: "arp" },
            { label: "Cached", detail: `${GW.ip} → ${GW.mac}`, tone: "success" },
            { label: "Reused", detail: "later packets — to any remote destination — use the same gateway MAC", tone: "success" },
            { label: "Aged / revalidated", detail: "removed or refreshed; resolved again when needed", tone: "violet" },
          ]}
        />
        <p>
          Entries can disappear or be refreshed when they age out, when an interface changes state, when the neighbor’s information changes, or when the implementation decides to revalidate. <Strong>Timers and cache states vary by operating system and vendor</Strong> — there is no single universal ARP timeout.
        </p>
        <CompareCards
          items={[
            { title: "Dynamic entry", tone: "success", tag: "normal", points: ["Learned by the ARP exchange", "Ages out and is re-learned automatically", "What ordinary hosts use"] },
            { title: "Static entry", tone: "warning", tag: "special cases", points: ["Configured manually", "Doesn’t change by itself — must be maintained by hand", "Used only for specific operational needs"] },
          ]}
        />
      </GuideSection>

      {/* ============================== OPERATIONS */}
      <GuideSection id="d-cli" eyebrow="Operations" title="Real device CLI — Cisco and Juniper" tone="cyan">
        <p>Different syntax, same engineering question. These outputs show this network once the Laptop has resolved its gateway — printed by the ARP Lab’s own terminals from the lab’s model.</p>
        <CliCompare device="router" question={`Which IPv4 neighbors has ${R1} resolved, and on which interface?`} lookFor="the IP address, its MAC, the interface, and age/flags where shown." cisco="show ip arp" junos="show arp" />
        <CliCompare device="switch" question={`Which port does ${SW} use to reach each MAC?`} lookFor="the MAC address, the VLAN (or routing instance), and the interface." cisco="show mac address-table" junos="show ethernet-switching table" />
        <CliCompare device="router" question={`Are ${R1}’s interfaces up, and with which addresses?`} lookFor="admin/link status and the IPv4 address on each interface — an interface that is down can’t form ARP entries." cisco="show ip interface brief" junos="show interfaces terse" />
      </GuideSection>

      <GuideSection id="d-before-after" eyebrow="Operations · exercise" title="Before and after, on the CLI" tone="cyan">
        <p>What the tables contain at three moments of the Laptop’s first ping to the Server — the same moments you can pause on in the ARP Lab:</p>
        <BeforeAfter />
        <CliCompare device="switch" state={LAB_T1} question={`After the Request only: what does ${SW} know?`} lookFor="exactly one dynamic entry — the Laptop on Fa0/1 (ge-0/0/1 on Junos). R1 isn’t known yet: its Reply hasn’t crossed the switch." cisco="show mac address-table" junos="show ethernet-switching table" />
        <PracticeBridge label="Reproduce this in the ARP Lab" onPractice={onOpenLab}>
          Reset the lab, prove the tables are empty, then watch each stage appear in the CLI.
        </PracticeBridge>
      </GuideSection>

      <GuideSection id="d-troubleshoot" eyebrow="Operations" title="Troubleshooting ARP step by step" tone="warning">
        <p>
          A user says: <Strong>“I cannot reach my gateway.”</Strong> Don’t start by memorising commands — start with questions, in order. Each one tells you where to look next:
        </p>
        <TroubleshootFlow />
      </GuideSection>

      <GuideSection id="d-failures" eyebrow="Operations" title="Failure signatures" tone="warning">
        <p>Where the exchange stops tells you what to investigate:</p>
        <FailureCards />
        <p>Five failures you can reproduce in the ARP Lab — each looks like &quot;can&apos;t reach it&quot;, and each leaves different evidence:</p>
        <CompareCards
          items={[
            { title: "Wrong default gateway", tone: "danger", tag: "remote fails, local works", points: ["The ARP target is an address nobody owns", "Entry stays incomplete; Windows: “Destination host unreachable” from its own IP", "Fix the gateway, ping again"] },
            { title: "Wrong mask", tone: "warning", tag: "works, but via the router", points: ["A local host is judged remote: the ARP target is the gateway", "Echo frames carry R1’s MAC with PC-B’s IP; replies come back directly", "Fix the mask; the next echo goes to PC-B’s MAC"] },
            { title: "Wrong static entry", tone: "danger", tag: "one host can’t reach one neighbor", points: ["arp -a shows the entry as static, with a MAC the target doesn’t have", "No ARP is ever sent; the frames are flooded and discarded", "Delete the entry; the next packet ARPs and learns the real MAC"] },
            { title: "Duplicate IP", tone: "warning", tag: "replies from the wrong host", points: ["Two replies to one request; the last one wins the cache", "The cached MAC sits on the wrong switch port", "Fix the duplicate, clear the stale entry, verify on the right host"] },
            { title: "Layer-2 path down", tone: "danger", tag: "nobody reaches the host", points: ["The request never reaches the target (its capture is empty)", "Switch port disabled or not connected", "Restore the port, then verify the reply arrives"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="d-myths" eyebrow="Operations" title="Common mistakes and misconceptions" tone="danger">
        <Myths />
      </GuideSection>

      {/* ============================== ADVANCED */}
      <GuideSection id="d-gratuitous" eyebrow="Advanced" title="Gratuitous ARP" tone="violet">
        <p>
          A <Strong>gratuitous ARP</Strong> is an ARP message about the sender’s <em>own</em> IPv4 address (sender IP and target IP are the same), sent without anyone asking. Depending on the implementation it is used to:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>announce or update an IP-to-MAC mapping so neighbors refresh their caches;</li>
          <li>notice a duplicate address (if someone else answers for “my” IP);</li>
          <li>handle failover and first-hop redundancy: a newly active device announces that the shared gateway IP now lives at its MAC;</li>
          <li>signal an interface or MAC change, so switches and hosts update quickly.</li>
        </ul>
        <p className="text-xs text-pv-text-faint">There isn’t one universal packet form: implementations send it as a request or a reply, for different reasons.</p>
      </GuideSection>

      <GuideSection id="d-proxy" eyebrow="Advanced" title="Proxy ARP" tone="violet">
        <p>
          Normally a router answers ARP only for its <Strong>own</Strong> interface addresses — exactly what R1 did. With <Strong>Proxy ARP</Strong> enabled, a router may answer an ARP request for some <em>other</em> IPv4 address, with its own MAC, according to its routing and interface configuration. The host then sends that traffic to the router as if it were the destination.
        </p>
        <Callout tone="warning" title="Not active in this scenario" icon="!">
          Proxy ARP changes the normal mental model: a host may appear to ARP successfully for an off-subnet address. It is disabled in PacketVerse’s First Connection network — learn normal ARP first.
        </Callout>
      </GuideSection>

      <GuideSection id="d-security" eyebrow="Advanced" title="ARP security" tone="danger">
        <p>
          ARP has <Strong>no built-in authentication</Strong>. A receiver can’t verify that whoever answers for <Mono>{GW.ip}</Mono> really owns it, so a device on the LAN can advertise false IP-to-MAC information. This is called <Strong>ARP spoofing</Strong> or <Strong>ARP poisoning</Strong>, and it can cause traffic redirection, man-in-the-middle interception or denial of service.
        </p>
        <ChecklistCard
          tone="success"
          mark="✓"
          title="Defensive measures (conceptual)"
          items={[
            <>
              <b>Dynamic ARP Inspection</b> on switches: checks ARP packets on untrusted ports against trusted bindings.
            </>,
            <>
              <b>DHCP snooping</b> bindings: the trusted IP-to-MAC-to-port records that inspection relies on.
            </>,
            <>
              <b>Static mappings</b> for a few critical neighbors, where manual maintenance is acceptable.
            </>,
            <>
              <b>Segmentation and access controls</b> that limit who shares a broadcast domain — plus encryption (e.g. TLS) so intercepted traffic stays unreadable.
            </>,
          ]}
        />
      </GuideSection>

      <GuideSection id="d-ipv6" eyebrow="Advanced" title="ARP is IPv4 only — IPv6 uses ND" tone="violet">
        <CompareCards
          items={[
            { title: "IPv4 · ARP", tone: "arp", tag: "EtherType 0x0806", points: ["Its own protocol, directly inside Ethernet", "ARP Request / ARP Reply", "Request sent to the broadcast MAC", "Results stored in the ARP cache"] },
            { title: "IPv6 · Neighbor Discovery", tone: "ip", tag: "ICMPv6", points: ["Messages carried inside IPv6 (ICMPv6)", "Neighbor Solicitation / Neighbor Advertisement", "Solicitation sent to a multicast address, not broadcast", "Results stored in the neighbor cache"] },
          ]}
        />
        <p className="text-xs text-pv-text-faint">Same job — find a neighbor’s link-layer address — different protocol. IPv6 has no ARP.</p>
      </GuideSection>

      {/* ============================== MASTER IT */}
      <GuideSection id="d-walk" eyebrow="Master it" title="The end-to-end packet walk" tone="violet">
        <p>Your master mental model. Each step is one decision by one device:</p>
        <FlowSteps
          steps={[
            { title: "Compare", body: <>The Laptop compares <Mono>{SERVER.ip}</Mono> with its <Mono>/24</Mono>.</>, tone: "cyan" },
            { title: "Remote", body: "The destination is not on the local subnet.", tone: "cyan" },
            { title: "Choose the next hop", body: <>Default gateway <Mono>{GW.ip}</Mono>.</>, tone: "cyan" },
            { title: "Check the cache", body: "No ARP entry for the gateway.", tone: "arp" },
            { title: "ARP Request", body: `Broadcast: who has ${GW.ip}? Tell ${LAPTOP.ip}.`, tone: "arp" },
            { title: `${SW} learns`, body: <><Mono>{LAPTOP.mac} → Fa0/1</Mono> from the source MAC.</>, tone: "ethernet" },
            { title: `${SW} floods`, body: "Broadcast out Fa0/2 toward R1.", tone: "ethernet" },
            { title: "R1 recognizes the target", body: <><Mono>{GW.ip}</Mono> is its own interface.</>, tone: "ip" },
            { title: "R1 learns the sender", body: <Mono>{`${LAPTOP.ip} → ${LAPTOP.mac}`}</Mono>, tone: "ip" },
            { title: "ARP Reply", body: `Unicast: ${GW.ip} is at ${GW.mac}.`, tone: "arp" },
            { title: `${SW} learns R1`, body: <><Mono>{GW.mac} → Fa0/2</Mono> from the source MAC.</>, tone: "ethernet" },
            { title: `${SW} forwards the reply`, body: "Known unicast out Fa0/1.", tone: "ethernet" },
            { title: "Laptop caches", body: <Mono>{`${GW.ip} → ${GW.mac}`}</Mono>, tone: "success" },
            { title: "Build the IP packet", body: <>IPv4 destination <Mono>{SERVER.ip}</Mono>.</>, tone: "ip" },
            { title: "Build the Ethernet frame", body: <>Ethernet destination <Mono>{GW.mac}</Mono> (R1).</>, tone: "arp" },
            { title: `${SW} known-unicast`, body: "Forwards out Fa0/2 to R1 — no flooding.", tone: "ethernet" },
            { title: "R1 decides the next hop", body: <>Route lookup for <Mono>{SUBNETS.server.network}</Mono>; ARP there only if the Server’s MAC isn’t cached.</>, tone: "ip" },
          ]}
        />
      </GuideSection>

      <GuideSection id="d-quiz" eyebrow="Master it" title="Knowledge check" tone="violet">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="d-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <p>If you can explain these five statements in your own words, you understand ARP — which is worth more than any definition.</p>
        <ExplainIt
          items={[
            { q: "Why does a remote destination cause the Laptop to ARP for the gateway?", a: <>Ethernet only reaches the local link. {SERVER.ip} is on another network, so the frame only needs to reach the next hop, R1 — whose LAN address {GW.ip} is the gateway. ARP finds that next hop’s MAC.</> },
            { q: `Why does ${SW} learn the Laptop MAC before the ARP Reply exists?`, a: <>Switches learn the source MAC of every frame on ingress. The ARP Request itself carried source {LAPTOP.mac} into Fa0/1.</> },
            { q: "Why does the ARP Request stop at R1?", a: <>It is an Ethernet broadcast. Broadcasts are flooded within one broadcast domain; a router terminates that domain and doesn’t forward ordinary broadcasts into another subnet.</> },
            { q: "Why does the final data frame contain the Router’s MAC but the Server’s IP?", a: <>MAC = next hop on this link (R1). IP = final destination (the Server). Each router rewrites the Ethernet header; the IP destination stays the same.</> },
            { q: "What is the difference between an ARP table and a MAC table?", a: <>ARP table: IPv4 → MAC, kept by hosts and routers, filled by ARP. MAC table: MAC → port, kept by switches, filled by source-MAC learning.</> },
          ]}
        />
      </GuideSection>

      <GuideSection id="d-practice" eyebrow="Master it" title="Practice what you learned" tone="cyan">
        <p>Open the ARP Lab — the lesson’s network plus PC-B and PC-C, with Windows, Linux, Cisco and Junos terminals — and complete this mission:</p>
        <ol className="grid gap-1.5 sm:grid-cols-2">
          {[
            "Work through the five Learn levels.",
            "In the workspace, prove every cache is empty (arp -a, ip neigh, show ip arp).",
            "Ping PC-B from the Laptop and name who received the Request.",
            "Show that PC-C learned nothing, and why.",
            "Ping again and prove no ARP was sent.",
            "Ping the Server: which IP did the Laptop ARP for?",
            "Find the Server’s MAC — on R1, not on the Laptop.",
            "Compare SW1’s show ip arp with its MAC table.",
            "Solve every ticket from evidence.",
            "Explain one failure signature to someone else.",
          ].map((m, i) => (
            <li key={m} className="flex gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-pv-text">
              <span className="pv-mono text-pv-cyan-soft">{i + 1}.</span>
              {m}
            </li>
          ))}
        </ol>
        <PracticeBridge label="Open ARP Lab" onPractice={onOpenLab}>
          The lab is a sandbox: it never changes your lesson progress.
        </PracticeBridge>
      </GuideSection>
    </>
  );
}
