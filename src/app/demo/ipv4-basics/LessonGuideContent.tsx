import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, DRegion, FieldTable, FlowSteps, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { DFieldRow } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { GATEWAY, V4_FAULT_PREFIX, V4_IP, V4_MAC, V4_PREFIX, maskOf, networkOf, toBinary } from "@/lib/sim-engine/scenarios/ipv4Basics";
import { V4_HOSTS, createV4Net, hex4, v4Apply, v4RunAll, type V4Action, type V4Frame, type V4H, type V4NetState } from "@/lib/sim-engine/scenarios/ipv4Net";
import { v4HostSet, v4R1Sets, type V4CliApi } from "./ipv4-lab/v4Cli";

/**
 * IPv4 LESSON GUIDE — the lesson's story on the IPv4 Lab's network (HOST-A and HOST-C on LAN A, HOST-B on LAN B, R1
 * between them): the mask, the local-or-remote test, the gateway, R1's new frame and TTL, then the wrong-mask incident.
 * Every output and every frame value comes from the IPv4 Lab's own model and terminals.
 */
export const V4_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "v4-mission", label: "What this lesson teaches" },
  { id: "v4-network", label: "The network of this lesson" },
  { id: "v4-ideas", label: "Three ideas you need" },
  { id: "v4-walk", label: "What you will watch" },
  { id: "v4-address", label: "An address names a network" },
  { id: "v4-decision", label: "Local or remote: the AND test" },
  { id: "v4-local", label: "Local: straight to HOST-C" },
  { id: "v4-gateway", label: "Remote: hand it to the gateway" },
  { id: "v4-router", label: "Inside R1: a new frame" },
  { id: "v4-ttl", label: "TTL: the router's fingerprint" },
  { id: "v4-verify", label: "What working looks like" },
  { id: "v4-incident", label: "The incident" },
  { id: "v4-investigate", label: "Where did HOST-A send it?" },
  { id: "v4-repair", label: "Repair and prove it" },
  { id: "v4-other", label: "Other ways IPv4 breaks" },
  { id: "v4-model", label: "Mental model" },
  { id: "v4-glossary", label: "Glossary" },
  { id: "v4-recap", label: "Recap" },
  { id: "v4-practice", label: "Practice it" },
];

const A = V4_IP["HOST-A"];
const B = V4_IP["HOST-B"];
const C = V4_HOSTS.hostc.cfg.ip;
const MASK = maskOf(V4_PREFIX);
const last = (ip: string) => `.${ip.split(".")[3]}`;

/** The IPv4 Lab's own terminals, run against a lab state (a ping typed there runs on a copy of that state). */
function lessonCli(s: V4NetState, dev: V4H | "r1", vendor: CliVendor, command: string) {
  const api: V4CliApi = { view: s, act: (a) => v4Apply(s, a), cisco: { kind: "exec" }, setCisco: () => undefined, junosEdit: false, setJunosEdit: () => undefined, cand: s.r1, setCand: () => undefined, hist: [{ r1: s.r1, at: 0, by: "root" }], commit: () => undefined };
  return runGuideCli(dev === "r1" ? v4R1Sets(api)[vendor] : v4HostSet(api, dev), command);
}
const ping = (src: V4H, dst: string): V4Action => ({ type: "ping", src, dst, count: 1 });
/** HOST-A has pinged HOST-C, then HOST-B. */
const HEALTHY = v4RunAll(createV4Net(), [ping("hosta", C), ping("hosta", B)]);
/** The lab's "mask" ticket, after HOST-A tried HOST-B. */
const BROKEN = v4RunAll(createV4Net(), [{ type: "ticket", id: "mask" }, ping("hosta", B)]);
const FIXED = v4RunAll(BROKEN, [{ type: "host-cfg", host: "hosta", cfg: { ip: A, prefix: V4_PREFIX, gw: V4_IP.R1L } }, ping("hosta", B)]);
/** The two frames of HOST-A's echo to HOST-B: before and after R1 (the lab's own captures). */
const ROUTED = (() => {
  const r = HEALTHY.last?.type === "ping" ? HEALTHY.last.result : undefined;
  const step = r?.router.find((x) => x.outcome === "forwarded" && x.dst === B);
  return step && step.outFrame ? { inF: step.inFrame, outF: step.outFrame } : undefined;
})();

function TopologyDiagram() {
  return (
    <DiagramSvg h={220} label={`LAN A ${networkOf(A, V4_PREFIX)}/${V4_PREFIX}: HOST-A ${A}, HOST-C ${C} and R1 ge-0/0/0 ${V4_IP.R1L} on SW-A. LAN B ${networkOf(B, V4_PREFIX)}/${V4_PREFIX}: R1 ge-0/0/1 ${V4_IP.R1R} and HOST-B ${B} on SW-B`}>
      <DRegion x={10} y={20} w={300} h={186} label={`LAN A · ${networkOf(A, V4_PREFIX)}/${V4_PREFIX}`} color={D.cyan} />
      <DRegion x={330} y={20} w={300} h={186} label={`LAN B · ${networkOf(B, V4_PREFIX)}/${V4_PREFIX}`} color={D.violet} />
      <DNode x={70} y={80} label="HOST-A" sub={`${last(A)}/${V4_PREFIX}`} w={96} />
      <DNode x={70} y={160} label="HOST-C" sub={`${last(C)}/${V4_PREFIX}`} w={96} />
      <DNode x={185} y={120} label="SW-A" accent={D.eth} w={70} />
      <DNode x={320} y={120} label="R1" sub={`${last(V4_IP.R1L)} | ${last(V4_IP.R1R)}`} accent={D.ip} w={90} />
      <DNode x={455} y={120} label="SW-B" accent={D.eth} w={70} />
      <DNode x={570} y={120} label="HOST-B" sub={`${last(B)}/${V4_PREFIX}`} w={96} />
      <DLink x1={118} y1={88} x2={150} y2={112} />
      <DLink x1={118} y1={152} x2={150} y2={128} />
      <DLink x1={220} y1={120} x2={275} y2={120} />
      <DLink x1={365} y1={120} x2={420} y2={120} />
      <DLink x1={490} y1={120} x2={522} y2={120} />
      <text x={320} y={170} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        connected routes only
      </text>
      <text x={570} y={170} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        gw {GATEWAY["HOST-B"]}
      </text>
      <text x={185} y={190} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        gw {GATEWAY["HOST-A"]}
      </text>
    </DiagramSvg>
  );
}

/** The same echo on its two links: Ethernet rebuilt by R1, IPv4 addresses kept, TTL and checksum changed. */
function HopsDiagram({ inF, outF }: { inF: V4Frame; outF: V4Frame }) {
  const short = (m: string) => m.slice(-5);
  const seg = (y: number, title: string, f: V4Frame, srcName: string, dstName: string) => (
    <g>
      <text x={20} y={y - 8} fill={D.muted} fontSize={10} fontWeight={700}>
        {title}
      </text>
      <DFieldRow
        x={20}
        y={y}
        h={40}
        fields={[
          { label: "Ethernet", sub: `${short(f.ethSrc)} (${srcName}) → ${short(f.ethDst)} (${dstName})`, w: 250, color: D.eth, strong: true },
          { label: "IPv4", sub: `${f.ip!.src} → ${f.ip!.dst}`, w: 190, color: D.ip },
          { label: `TTL ${f.ip!.ttl}`, sub: `csum ${hex4(f.ip!.checksum)}`, w: 110, color: D.warning, strong: true },
          { label: "ICMP", w: 50, color: D.success },
        ]}
      />
    </g>
  );
  return (
    <DiagramSvg h={200} label={`LAN A frame ${inF.ethSrc} to ${inF.ethDst} with TTL ${inF.ip!.ttl}; LAN B frame ${outF.ethSrc} to ${outF.ethDst} with TTL ${outF.ip!.ttl}; IPv4 source and destination unchanged`}>
      {seg(40, `HOST-A → R1 (LAN A, ${networkOf(A, V4_PREFIX)}/${V4_PREFIX})`, inF, "HOST-A", "R1")}
      {seg(146, `R1 → HOST-B (LAN B, ${networkOf(B, V4_PREFIX)}/${V4_PREFIX})`, outF, "R1", "HOST-B")}
      <text x={320} y={108} textAnchor="middle" fill={D.warning} fontSize={10.5} fontWeight={700}>
        ↓ R1: new Ethernet header · TTL −1 · checksum recomputed · IPv4 addresses untouched
      </text>
    </DiagramSvg>
  );
}

function BinaryDiagram() {
  const rows = [
    { k: "HOST-A", v: toBinary(A), d: A, c: D.text },
    { k: `mask /${V4_PREFIX}`, v: toBinary(MASK), d: MASK, c: D.violet },
    { k: "AND →", v: toBinary(networkOf(A, V4_PREFIX)), d: networkOf(A, V4_PREFIX), c: D.success },
  ];
  // Split each binary string at the prefix boundary (26 bits + 3 dots) so the line never depends on glyph widths.
  const cut = V4_PREFIX + Math.floor(V4_PREFIX / 8);
  const boundary = 400;
  const x0 = 130;
  return (
    <DiagramSvg h={190} label={`${A} AND ${MASK} = ${networkOf(A, V4_PREFIX)}: the first ${V4_PREFIX} bits are network bits, the last ${32 - V4_PREFIX} are host bits`}>
      {rows.map((r, i) => (
        <g key={r.k}>
          <text x={20} y={50 + i * 34} fill={D.muted} fontSize={11} fontWeight={700}>
            {r.k}
          </text>
          <text x={boundary - 5} y={50 + i * 34} textAnchor="end" fill={r.c} fontSize={13} fontFamily="monospace">
            {r.v.slice(0, cut)}
          </text>
          <text x={boundary + 5} y={50 + i * 34} fill={r.c} fontSize={13} fontFamily="monospace">
            {r.v.slice(cut)}
          </text>
          <text x={boundary + 80} y={50 + i * 34} fill={r.c} fontSize={11} fontFamily="monospace">
            {r.d}
          </text>
        </g>
      ))}
      <line x1={boundary} y1={26} x2={boundary} y2={128} stroke={D.warning} strokeWidth={2} strokeDasharray="4 3" />
      <text x={x0 + (boundary - x0) / 2} y={152} textAnchor="middle" fill={D.violet} fontSize={10.5} fontWeight={700}>
        {V4_PREFIX} network bits
      </text>
      <text x={boundary + 30} y={152} textAnchor="middle" fill={D.success} fontSize={10.5} fontWeight={700}>
        {32 - V4_PREFIX} host bits
      </text>
      <text x={20} y={178} fill={D.muted} fontSize={10}>
        A 1 in the mask keeps the address bit; a 0 clears it. The result is the network address.
      </text>
    </DiagramSvg>
  );
}

function DecisionDiagram() {
  return (
    <DiagramSvg h={200} label={`HOST-A ANDs ${A} and ${B} with ${MASK}: ${networkOf(A, V4_PREFIX)} vs ${networkOf(B, V4_PREFIX)}, different, so the frame goes to gateway ${GATEWAY["HOST-A"]} while the IPv4 destination stays ${B}`}>
      <DNode x={132} y={40} label={`${A} AND ${MASK}`} w={240} accent={D.cyan} />
      <DNode x={132} y={100} label={`${B} AND ${MASK}`} w={240} accent={D.violet} />
      <DPill x={330} y={40} text={networkOf(A, V4_PREFIX)} color={D.cyan} />
      <DPill x={330} y={100} text={networkOf(B, V4_PREFIX)} color={D.violet} />
      <DArrow x1={254} y1={40} x2={285} y2={40} color={D.cyan} />
      <DArrow x1={254} y1={100} x2={285} y2={100} color={D.violet} />
      <text x={420} y={64} fill={D.warning} fontSize={12} fontWeight={800}>
        ≠ → REMOTE
      </text>
      <text x={420} y={84} fill={D.muted} fontSize={10}>
        use the default gateway
      </text>
      <rect x={20} y={138} width={600} height={50} rx={10} fill={D.box} stroke={D.line} />
      <text x={36} y={158} fill={D.eth} fontSize={10.5} fontWeight={700}>
        Ethernet dst: {V4_MAC.R1L} (R1, L2 next hop)
      </text>
      <text x={36} y={178} fill={D.ip} fontSize={10.5} fontWeight={700}>
        IPv4 dst: {B} (HOST-B, unchanged end to end)
      </text>
    </DiagramSvg>
  );
}

function IncidentDiagram() {
  return (
    <DiagramSvg h={230} label={`With /${V4_FAULT_PREFIX}, HOST-A computes the same network ${networkOf(A, V4_FAULT_PREFIX)} for itself and ${B}, so it ARPs for ${B} directly; the broadcast stops at R1, which has no Proxy ARP, and nothing answers`}>
      <DNode x={120} y={36} label={`/${V4_FAULT_PREFIX}: ${A} → ${networkOf(A, V4_FAULT_PREFIX)}`} w={220} accent={D.danger} />
      <DNode x={120} y={84} label={`/${V4_FAULT_PREFIX}: ${B} → ${networkOf(B, V4_FAULT_PREFIX)}`} w={220} accent={D.danger} />
      <text x={250} y={64} fill={D.danger} fontSize={11.5} fontWeight={800}>
        = → on-link (wrong)
      </text>
      <DNode x={60} y={170} label="HOST-A" sub={`${last(A)}/${V4_FAULT_PREFIX}`} w={96} accent={D.danger} />
      <DNode x={235} y={170} label="SW-A" accent={D.eth} w={70} />
      <DNode x={405} y={170} label="R1" sub="no Proxy ARP" accent={D.ip} w={100} />
      <DNode x={580} y={170} label="HOST-B" sub="never asked" w={100} accent={D.faint} />
      <DArrow x1={108} y1={170} x2={198} y2={170} color={D.arp} label="who-has .70" />
      <DArrow x1={272} y1={170} x2={353} y2={170} color={D.arp} label="flooded" />
      <DLink x1={457} y1={170} x2={528} y2={170} color={D.danger} dashed />
      <text x={20} y={218} fill={D.muted} fontSize={10}>
        The ARP broadcast stops at R1 (routers don&apos;t forward broadcasts). No reply → HOST-A can&apos;t frame the packet.
      </text>
    </DiagramSvg>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the IPv4 Lab" onPractice={openLab}>
      Same network, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

export function Ipv4LessonGuideContent() {
  const routeOk = lessonCli(HEALTHY, "hosta", "cisco", `ip route get ${B}`);
  const pingOk = lessonCli(HEALTHY, "hosta", "cisco", `ping -c 2 ${B}`);
  const pingLocal = lessonCli(HEALTHY, "hosta", "cisco", `ping -c 2 ${C}`);
  const ttlOne = lessonCli(HEALTHY, "hosta", "cisco", `ping -c 1 -t 1 ${B}`);
  const r1Route = lessonCli(HEALTHY, "r1", "cisco", "show ip route");
  const pingBad = lessonCli(BROKEN, "hosta", "cisco", `ping -c 2 ${B}`);
  const routeBad = lessonCli(BROKEN, "hosta", "cisco", `ip route get ${B}`);
  const neighBad = lessonCli(BROKEN, "hosta", "cisco", "ip neigh");
  const addrBad = lessonCli(BROKEN, "hosta", "cisco", "ip addr");
  const routeFixed = lessonCli(FIXED, "hosta", "cisco", `ip route get ${B}`);
  const pingFixed = lessonCli(FIXED, "hosta", "cisco", `ping -c 2 ${B}`);
  const pingLines = /PING|bytes from|From|transmitted/;
  return (
    <div className="space-y-12">
      <GuideSection id="v4-mission" eyebrow="This lesson" title="What this lesson teaches" tone="ip">
        <p>
          HOST-A and HOST-C share one LAN. HOST-B is on another LAN, and the router R1 joins the two. Ethernet only reaches the devices on its own LAN, so before every packet HOST-A has to decide: can I deliver this myself, or must I hand it to the router?
        </p>
        <p>
          This lesson shows how <strong>IPv4</strong> answers that: you watch HOST-A use its address and mask to decide local or remote, send to HOST-C directly, send HOST-B&apos;s packet to its gateway, and watch R1 build a new frame and lower the TTL. Then HOST-A can reach HOST-C but not HOST-B, and you find out why, fix it, and prove it.
        </p>
        <ChecklistCard
          tone="ip"
          title="By the end of this lesson you can"
          mark="→"
          items={[
            "split an address into its network and host parts with the mask",
            "decide, for any destination, whether HOST-A delivers it directly or through its gateway",
            "say which addresses a frame carries on each link, and which never change",
            "explain what R1 changes in the packet, and read a TTL to count routers",
            "find and repair the incident of this lesson from HOST-A's own evidence, and prove it",
          ]}
        />
      </GuideSection>

      <GuideSection id="v4-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="Two LANs, one router. Each host has an address, a mask (/26) and a default gateway: R1's address on its own LAN.">
          <TopologyDiagram />
        </DiagramFrame>
        <FieldTable
          title="Who is where"
          columns={["Device", "Address / mask", "Gateway", "LAN"]}
          rows={[
            ["HOST-A (Linux)", `${A}/${V4_PREFIX}`, V4_IP.R1L, "A, on SW-A"],
            ["HOST-C (Windows)", `${C}/${V4_PREFIX}`, V4_IP.R1L, "A, on SW-A"],
            ["R1 ge-0/0/0", `${V4_IP.R1L}/${V4_PREFIX}`, "—", "A"],
            ["R1 ge-0/0/1", `${V4_IP.R1R}/${V4_PREFIX}`, "—", "B"],
            ["HOST-B (Linux)", `${B}/${V4_PREFIX}`, V4_IP.R1R, "B, on SW-B"],
          ]}
        />
        <p className="text-sm text-pv-text-muted">
          R1 has no routing protocol and no static routes: it knows the two LANs because its interfaces are in them (connected routes). On Cisco its ports are Gi0/0 and Gi0/1. How the 192.168.10.0/24 range was cut into these /26 pieces is the next lesson, Subnetting; here the masks are simply given.
        </p>
      </GuideSection>

      <GuideSection id="v4-ideas" eyebrow="This lesson" title="Three ideas you need" tone="cyan">
        <FlowSteps
          steps={[
            { title: "The mask splits the address", body: `The first ${V4_PREFIX} bits name the network, the rest name the host. Two addresses with the same network part are on the same LAN.`, tone: "violet" },
            { title: "Local goes direct, remote goes to the gateway", body: "Same network: the host frames the packet to the destination itself. Different network: to its default gateway.", tone: "ip" },
            { title: "Routers rebuild the frame, not the packet", body: "R1 throws away the Ethernet frame and builds a new one for the next LAN. The IPv4 addresses stay; only TTL and checksum change.", tone: "warning" },
          ]}
        />
      </GuideSection>

      <GuideSection id="v4-walk" eyebrow="This lesson" title="What you will watch, step by step" tone="warning">
        <FlowSteps
          steps={[
            { title: "The mask", body: `HOST-A's /${V4_PREFIX} says where LAN A ends.`, tone: "violet" },
            { title: "The decision", body: "HOST-C: same network. HOST-B: another network.", tone: "cyan" },
            { title: "Local delivery", body: "HOST-A → HOST-C, one frame, no router.", tone: "success" },
            { title: "The gateway", body: "HOST-A → HOST-B: the frame goes to R1, the packet is still for HOST-B.", tone: "ip" },
            { title: "Through R1", body: "A new frame on LAN B, TTL one lower.", tone: "warning" },
            { title: "The incident", body: "HOST-A reaches HOST-C but not HOST-B. You find out why and fix it.", tone: "danger" },
          ]}
        />
        <p className="text-sm text-pv-text-muted">The sections below walk through each step on this network, in the same order.</p>
      </GuideSection>

      <GuideSection id="v4-address" eyebrow="Address and mask" title="An address names a network and a host" tone="violet">
        <p>
          A MAC address only says which card; it says nothing about where the card is. An IPv4 address has two parts: the <strong>network</strong> it belongs to, and the <strong>host</strong> within it. The mask says where the line falls. HOST-A&apos;s mask is /{V4_PREFIX}, written <Mono>{MASK}</Mono>: {V4_PREFIX} ones, then {32 - V4_PREFIX} zeros.
        </p>
        <DiagramFrame caption={`ANDing the address with the mask keeps the network bits and clears the host bits: HOST-A is on ${networkOf(A, V4_PREFIX)}/${V4_PREFIX}.`}>
          <BinaryDiagram />
        </DiagramFrame>
        <p>Routers forward on the network part, the same way a postal service sorts by city before street. That is what lets a packet cross from one LAN to another, where a MAC address can&apos;t.</p>
      </GuideSection>

      <GuideSection id="v4-decision" eyebrow="The decision" title="Local or remote: the AND test" tone="cyan">
        <p>Before every packet HOST-A ANDs the destination with <em>its own</em> mask and compares the result with its own network:</p>
        <FieldTable
          title="HOST-A's decision with /26"
          columns={["Destination", "AND 255.255.255.192", "HOST-A's network", "So"]}
          rows={[
            [`HOST-C ${C}`, networkOf(C, V4_PREFIX), networkOf(A, V4_PREFIX), "same: local, deliver it directly"],
            [`HOST-B ${B}`, networkOf(B, V4_PREFIX), networkOf(A, V4_PREFIX), "different: remote, use the gateway"],
          ]}
        />
        <DiagramFrame caption="Different network parts: HOST-B is remote. The frame goes to R1; the packet is still addressed to HOST-B.">
          <DecisionDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="v4-local" eyebrow="Local delivery" title="Local: straight to HOST-C" tone="success">
        <p>
          HOST-C is local, so HOST-A ARPs for <Mono>{C}</Mono> itself, gets HOST-C&apos;s MAC, and sends one frame: Ethernet destination HOST-C, IPv4 destination HOST-C. SW-A delivers it; R1 never sees it. HOST-C&apos;s reply arrives exactly as HOST-C sent it, with Windows&apos; starting TTL of 128:
        </p>
        <CliPanel run={{ ...pingLocal, output: pickLines(pingLocal.output, pingLines) }} caption="HOST-A · Linux · same LAN" />
      </GuideSection>

      <GuideSection id="v4-gateway" eyebrow="The gateway" title="Remote: hand it to the gateway" tone="ip">
        <p>
          HOST-B is remote. HOST-A doesn&apos;t try to find HOST-B on LAN A: it looks up its default gateway, <Mono>{V4_IP.R1L}</Mono>, ARPs for that address, and sends the packet in a frame addressed to R1&apos;s MAC <Mono>{V4_MAC.R1L}</Mono>. Inside, the IPv4 destination is still <Mono>{B}</Mono>.
        </p>
        <Callout tone="ip" title="Two destinations in one frame" icon="→">
          The <strong>Ethernet destination</strong> is the next device on this link: R1. The <strong>IPv4 destination</strong> is the final host: HOST-B. The first changes on every link; the second never does.
        </Callout>
        <p className="text-sm text-pv-text-muted">The gateway must be inside HOST-A&apos;s own network: HOST-A reaches it with ARP, which only works on its own LAN.</p>
      </GuideSection>

      <GuideSection id="v4-router" eyebrow="Through R1" title="Inside R1: a new frame for the next LAN" tone="warning">
        <p>
          R1 accepts the frame (it is addressed to R1&apos;s MAC), throws the Ethernet header away and reads the IPv4 destination. <Mono>{B}</Mono> falls inside <Mono>192.168.10.64/26</Mono>, connected on ge-0/0/1. R1 ARPs for HOST-B on that side, lowers the TTL by one, recomputes the header checksum, and sends the same packet in a brand-new frame from its own LAN B MAC to HOST-B&apos;s:
        </p>
        {ROUTED && (
          <DiagramFrame caption="The lab's own capture of HOST-A's echo, on each side of R1.">
            <HopsDiagram inF={ROUTED.inF} outF={ROUTED.outF} />
          </DiagramFrame>
        )}
        <p>HOST-B&apos;s reply makes the same trip in reverse: HOST-B finds HOST-A remote, sends to its own gateway <Mono>{V4_IP.R1R}</Mono>, and R1 builds a new frame on LAN A.</p>
      </GuideSection>

      <GuideSection id="v4-ttl" eyebrow="TTL" title="TTL: the router's fingerprint" tone="warning">
        <p>
          Every router lowers the TTL by one, and drops the packet if it reaches zero. It exists so a packet caught in a routing loop dies instead of circling for ever, and it leaves a trace you can read. HOST-B is Linux and starts at 64, so its replies reach HOST-A with TTL 63: one router crossed.
        </p>
        <p>Send a ping with TTL 1 and R1 can&apos;t forward it: the TTL would reach zero. R1 drops it and tells HOST-A so, from its own address:</p>
        <CliPanel run={{ ...ttlOne, output: pickLines(ttlOne.output, pingLines) }} caption="HOST-A · TTL 1 dies at R1" />
        <p>
          Everything in this story started with one number in HOST-A&apos;s settings: its mask. The mask decided local or remote, and that decided whether HOST-A ARPed for HOST-B or for R1. HOST-A never double-checks it. Keep that in mind: it is the key to the incident.
        </p>
      </GuideSection>

      <GuideSection id="v4-verify" eyebrow="Verification" title="What working looks like" tone="success">
        <p>Each idea of this lesson has one place that proves it. The commands are only the way to ask; what matters is what each answer proves.</p>
        <FieldTable
          title="Read the lesson on the devices"
          columns={["Question", "Linux host", "R1 Cisco / Junos", "What the answer proves"]}
          rows={[
            ["What address and mask?", <Mono key="1">ip addr</Mono>, <Mono key="2">show ip interface brief / show interfaces terse</Mono>, "The mask decides what the host calls local"],
            ["Direct, or through which gateway?", <Mono key="3">ip route get &lt;ip&gt;</Mono>, <Mono key="4">show ip route / show route</Mono>, "via = remote, through that gateway; no via = local"],
            ["Did the next hop answer ARP?", <Mono key="5">ip neigh</Mono>, <Mono key="6">show ip arp / show arp</Mono>, "REACHABLE: the frame can be built. FAILED: nobody answered"],
            ["How many routers crossed?", <Mono key="7">ping</Mono>, <Mono key="8">ping</Mono>, "Starting TTL minus received TTL"],
          ]}
        />
        <p>For HOST-B, HOST-A goes through its gateway, and HOST-B&apos;s replies come back one router lower:</p>
        <CliPanel run={routeOk} caption="HOST-A · Linux · healthy" />
        <CliPanel run={{ ...pingOk, output: pickLines(pingOk.output, pingLines) }} caption="HOST-A · Linux · healthy" />
        <p>R1 knows both LANs as connected networks, plus a /32 for each of its own addresses:</p>
        <CliPanel run={{ ...r1Route, output: pickLines(r1Route.output, /^[CL] /) }} caption="R1 · Cisco IOS · healthy" />
      </GuideSection>

      <GuideSection id="v4-incident" eyebrow="Incident" title="The incident: HOST-A can't reach HOST-B" tone="danger">
        <p>The user says: &quot;HOST-A reaches HOST-C fine, but pings to HOST-B say Destination Host Unreachable. Someone touched HOST-A&apos;s network settings yesterday.&quot; HOST-C still reaches HOST-B, and R1 reports no problem.</p>
        <DiagramFrame caption={`With /${V4_FAULT_PREFIX}, HOST-B looks local to HOST-A. HOST-A asks LAN A for HOST-B, and nobody there has that address.`}>
          <IncidentDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "What should happen", tone: "success", tag: "normal", points: ["HOST-B is remote: different network parts", `HOST-A ARPs for its gateway ${V4_IP.R1L}`, "R1 forwards the packet to LAN B"] },
            { title: "What happens", tone: "danger", tag: "incident", points: [`With /${V4_FAULT_PREFIX}, HOST-B looks local`, `HOST-A ARPs for ${B} on LAN A`, "Nobody answers; the packet never leaves HOST-A"] },
          ]}
        />
        <CompareCards
          items={[
            { title: "Why it fails", tone: "danger", tag: "cause", points: [`HOST-A's mask was changed to /${V4_FAULT_PREFIX} (255.255.255.0)`, `Its network is now ${networkOf(A, V4_FAULT_PREFIX)}/${V4_FAULT_PREFIX}, which contains ${B}`, "R1 doesn't answer ARP for another LAN's host"] },
            { title: "What it can't be", tone: "warning", tag: "red herrings", points: ["R1: HOST-C reaches HOST-B through it", "HOST-A's gateway: it is still right, just never used", "HOST-B: the request never gets to LAN B"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="v4-investigate" eyebrow="Investigation" title="Ask HOST-A where it sends the packet" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Who reports the error?", look: `From ${A}: HOST-A itself. The packet never left it.` },
            { question: "Where does HOST-A send HOST-B's packet?", look: "ip route get: no via. HOST-A thinks HOST-B is on its own LAN." },
            { question: "Why does it think so?", look: `ip addr: /${V4_FAULT_PREFIX}. LAN A is /${V4_PREFIX}.` },
          ]}
        />
        <CliPanel run={{ ...pingBad, output: pickLines(pingBad.output, pingLines) }} caption="HOST-A · the error comes from HOST-A" />
        <CliPanel run={routeBad} caption="HOST-A · no gateway in the path" />
        <CliPanel run={neighBad} caption="HOST-A · it asked LAN A for HOST-B" />
        <CliPanel run={{ ...addrBad, output: pickLines(addrBad.output, /inet 192/) }} caption="HOST-A · the mask" />
      </GuideSection>

      <GuideSection id="v4-repair" eyebrow="Repair" title="Repair, and prove it with a fresh test" tone="success">
        <p>
          Set HOST-A&apos;s mask back to /{V4_PREFIX} (<Mono>{MASK}</Mono>) in its network settings. Nothing on R1 or HOST-B changes: they were never at fault. The next packet to HOST-B goes through the gateway again:
        </p>
        <CliPanel run={routeFixed} caption="HOST-A · after the repair" />
        <CliPanel run={{ ...pingFixed, output: pickLines(pingFixed.output, pingLines) }} caption="HOST-A · after the repair" />
        <ChecklistCard
          tone="success"
          title="The proof"
          mark="✓"
          items={[
            `ip addr shows ${A}/${V4_PREFIX}`,
            `ip route get ${B} shows via ${V4_IP.R1L}`,
            "A fresh ping to HOST-B answers with ttl=63: through R1",
            "HOST-C was never interrupted",
          ]}
        />
      </GuideSection>

      <GuideSection id="v4-other" eyebrow="Troubleshooting" title="Other ways IPv4 breaks" tone="warning">
        <p>The wrong mask is one way for a packet to take the wrong first step. The lab&apos;s tickets add three more, each with its own evidence. The Deep Dive walks through all four with real output from the hosts and R1.</p>
        <CompareCards
          items={[
            { title: "A wrong gateway", tone: "danger", tag: "local works, remote doesn't", points: ["The gateway address is in the LAN, but nobody owns it", "ip neigh: that address FAILED", "The error comes from the host itself"] },
            { title: "No gateway on the far side", tone: "warning", tag: "silent timeout", points: ["The request reaches HOST-B", "HOST-B has no way to send the reply back", "No error at all: the ping just times out"] },
            { title: "A router interface down", tone: "violet", tag: "the router says no", points: ["R1 has lost the connected route", "R1 answers Destination Net Unreachable", "The error comes from R1's address, not the host's"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="v4-model" eyebrow="Mental model" title="An address with a city and a street" tone="cyan">
        <p>
          An IPv4 address is a postal address: the network part is the city, the host part the street. The mask tells a host how much of the address is the city. Same city: walk the letter over yourself. Another city: drop it at the post office, the gateway, which puts it in a new envelope for the next leg and stamps it once (the TTL). The letter itself keeps the same sender and recipient all the way. Get the mask wrong and the host walks around its own city looking for a street that is somewhere else.
        </p>
      </GuideSection>

      <GuideSection id="v4-glossary" eyebrow="Glossary" title="Terms used in this lesson" tone="violet">
        <Glossary
          items={[
            { term: "IPv4 address", def: "32 bits, written as four numbers: a network part and a host part." },
            { term: "Mask / prefix", def: `Says how many leading bits are the network part: /${V4_PREFIX} = ${MASK}.` },
            { term: "AND test", def: "Address AND mask = network address. Same result as the destination's: local." },
            { term: "Default gateway", def: "The router address, inside the host's own network, used for every remote destination." },
            { term: "Next hop", def: "The device on this link that gets the frame: the destination if local, the gateway if remote." },
            { term: "Connected route", def: "A network a router knows because one of its interfaces has an address in it." },
            { term: "TTL", def: "Time To Live: lowered by one at every router; at zero the packet is dropped and the sender told." },
          ]}
        />
      </GuideSection>

      <GuideSection id="v4-recap" eyebrow="Recap" title="What you can now explain" tone="success">
        <ChecklistCard
          tone="cyan"
          title="IPv4 in this lesson"
          mark="→"
          items={[
            "The mask splits an address into network and host parts",
            "Same network after the AND: deliver directly. Different: send to the default gateway",
            "Ethernet destination = next hop; IPv4 destination = final host, unchanged end to end",
            "R1 builds a new frame for each LAN and lowers the TTL by one",
            "TTL 63 from a Linux host means one router crossed",
            "A wrong mask makes a remote host look local: the host asks its own LAN and gets no answer",
          ]}
        />
      </GuideSection>

      <GuideSection id="v4-practice" eyebrow="Practice" title="Practice it" tone="cyan">
        <p>You now know what HOST-A should decide for every packet, and how to prove it. The IPv4 Lab gives you this network with Linux, Windows, Cisco and Junos terminals:</p>
        <FlowSteps
          steps={[
            { title: "Learn (5 levels)", body: "Address and prefix, local or remote, through R1, TTL and checksum, wrong settings.", tone: "violet" },
            { title: "Challenges (6)", body: "Shrink HOST-A's network, make a packet die at R1, break only the way back, move LAN B's gateway.", tone: "warning" },
            { title: "Troubleshoot (4 tickets)", body: "This lesson's incident and the three other faults above, reported as users report them.", tone: "danger" },
          ]}
        />
        <PresentationBridge>Watch the AND test, the gateway hand-off and R1&apos;s new frame animated in the IPv4 presentation.</PresentationBridge>
        <LessonLabBridge />
        <p className="text-sm text-pv-text-muted">For the full course (the IPv4 header field by field, CIDR, what a router changes and keeps, real output for every fault, a knowledge check), open the Deep Dive tab.</p>
      </GuideSection>
    </div>
  );
}
