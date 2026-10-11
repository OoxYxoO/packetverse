import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, FieldTable, FlowSteps, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { DFieldRow } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { BIG_DATA, ECHO_IDENTIFIER, FAULT_MTU, FIXED_DATA, IC_ADDR, INITIAL_TTL, PING_DATA } from "@/lib/sim-engine/scenarios/icmpDiagnostics";
import { createIcNet, icApply, icRun, type IcDev, type IcState } from "@/lib/sim-engine/scenarios/icmpNet";
import { icHostSet, icRouterSets, type IcCliApi } from "./icmp-lab/icCli";

/**
 * ICMP LESSON GUIDE — the lesson's story on the ICMP Lab's network (HOST-A → R1 → R2 → HOST-B): ping and its reply,
 * Time Exceeded and traceroute, the unreachables, size/MTU/DF, then the path-MTU black hole incident. Every output is
 * printed by the ICMP Lab's own terminals, run against the lab's model.
 */
export const IC_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "ic-mission", label: "What this lesson teaches" },
  { id: "ic-network", label: "The network of this lesson" },
  { id: "ic-ideas", label: "Three ideas you need" },
  { id: "ic-walk", label: "What you will watch" },
  { id: "ic-position", label: "ICMP rides inside IPv4" },
  { id: "ic-ping", label: "Ping: request and reply" },
  { id: "ic-ttl", label: "Time Exceeded" },
  { id: "ic-trace", label: "Traceroute: TTL 1, 2, 3" },
  { id: "ic-unreach", label: "Unreachable: who says no" },
  { id: "ic-silence", label: "Silence is evidence too" },
  { id: "ic-pmtu", label: "Size, MTU and DF" },
  { id: "ic-verify", label: "What working looks like" },
  { id: "ic-incident", label: "The incident" },
  { id: "ic-investigate", label: "Find the size that fails" },
  { id: "ic-repair", label: "Repair and prove it" },
  { id: "ic-other", label: "Other ways ICMP tells you" },
  { id: "ic-model", label: "Mental model" },
  { id: "ic-glossary", label: "Glossary" },
  { id: "ic-recap", label: "Recap" },
  { id: "ic-practice", label: "Practice it" },
];

/** The ICMP Lab's own terminals, run against a lab state (a probe typed there runs on a copy of that state). */
function lessonCli(s: IcState, dev: IcDev, vendor: CliVendor, command: string) {
  const r = dev === "R1" || dev === "R2" ? dev : "R1";
  const api: IcCliApi = { view: s, act: (a) => icApply(s, a), cisco: { kind: "exec" }, setCisco: () => undefined, junosEdit: false, setJunosEdit: () => undefined, cand: s.cfg[r], setCand: () => undefined, hist: [{ cfg: s.cfg[r], at: 0, by: "root" }], commit: () => undefined };
  return runGuideCli(dev === "R1" || dev === "R2" ? icRouterSets(api, dev)[vendor] : icHostSet(api, dev), command);
}
const HEALTHY = createIcNet();
/** The lab's "blackhole" ticket: the R1–R2 circuit carries 1400 bytes, and HOST-B drops ICMP 3/4. */
const BROKEN = icApply(createIcNet(), { type: "ticket", id: "blackhole" });
const AFTER_DOWNLOAD = icApply(BROKEN, { type: "curl", file: "big" });
const FIXED = (() => {
  const cfg = JSON.parse(JSON.stringify(BROKEN.cfg)) as IcState["cfg"];
  cfg["HOST-B"].input = [];
  return icRun(BROKEN, { type: "cfg", cfg, text: "HOST-B: sudo iptables -D INPUT 1" }, { type: "curl", file: "big" });
})();
const B = IC_ADDR["HOST-B"];
const BIG_URL = `http://${B}/files/big.iso`;
const SMALL_URL = `http://${B}/index.html`;

const ICMP = "#f472b6";

function PositionDiagram() {
  return (
    <DiagramSvg h={170} label="Frame layout: Ethernet header, IPv4 header with Protocol 1, ICMP header with Type, Code, Checksum, Identifier and Sequence, then data, then FCS. There is no TCP or UDP header.">
      <DFieldRow
        x={20}
        y={30}
        h={44}
        fields={[
          { label: "Ethernet", sub: "14 B", w: 90 },
          { label: "IPv4", sub: "Protocol = 1", w: 120, color: D.ip, strong: true },
          { label: "Type·Code", sub: "8/0", w: 90, color: ICMP, strong: true },
          { label: "Checksum", w: 80, color: ICMP },
          { label: "Id · Seq", sub: `${ECHO_IDENTIFIER} · 1`, w: 90, color: ICMP },
          { label: "Data", sub: `${PING_DATA} B`, w: 70, color: D.faint },
          { label: "FCS", w: 50 },
        ]}
      />
      <text x={20} y={104} fill={D.danger} fontSize={11} fontWeight={700}>
        ✕ no TCP header · ✕ no UDP header · ✕ no ports
      </text>
      <text x={20} y={126} fill={D.muted} fontSize={10}>
        The IPv4 Protocol field (1) is what tells the receiver an ICMP message follows.
      </text>
      <text x={20} y={146} fill={D.muted} fontSize={10}>
        IPv4 total length = 20 + 8 + {PING_DATA} = {20 + 8 + PING_DATA} bytes.
      </text>
    </DiagramSvg>
  );
}

function PingDiagram() {
  const xs = [70, 240, 410, 580];
  const names = ["HOST-A", "R1", "R2", "HOST-B"];
  return (
    <DiagramSvg h={220} label={`Echo Request TTL ${INITIAL_TTL} from HOST-A, 63 after R1, 62 after R2, arriving at HOST-B with 62; Echo Reply starts again at ${INITIAL_TTL} and arrives at HOST-A with 62`}>
      {names.map((n, i) => (
        <DNode key={n} x={xs[i]} y={110} label={n} accent={i === 0 || i === 3 ? D.cyan : D.ip} w={100} />
      ))}
      {[0, 1, 2].map((i) => (
        <DArrow key={`rq-${i}`} x1={xs[i] + 52} y1={96} x2={xs[i + 1] - 52} y2={96} color={ICMP} label={`TTL ${INITIAL_TTL - i}`} />
      ))}
      {[2, 1, 0].map((i) => (
        <DArrow key={`rp-${i}`} x1={xs[i + 1] - 52} y1={124} x2={xs[i] + 52} y2={124} color={D.success} label={`TTL ${INITIAL_TTL - (2 - i)}`} labelDy={18} />
      ))}
      <text x={20} y={30} fill={ICMP} fontSize={11} fontWeight={700}>
        Echo Request 8/0 →
      </text>
      <text x={20} y={190} fill={D.success} fontSize={11} fontWeight={700}>
        ← Echo Reply 0/0 (a new packet, TTL {INITIAL_TTL} again)
      </text>
      <text x={330} y={30} fill={D.muted} fontSize={10}>
        Routers decrement. Destinations don&apos;t.
      </text>
    </DiagramSvg>
  );
}

function EchoMatchDiagram() {
  return (
    <DiagramSvg h={160} label={`The Echo Reply copies the Identifier ${ECHO_IDENTIFIER}, the Sequence Number and the data from the Echo Request; only Type, checksum, addresses and TTL differ`}>
      <text x={20} y={22} fill={ICMP} fontSize={10.5} fontWeight={700}>
        Echo Request (HOST-A → HOST-B)
      </text>
      <DFieldRow x={20} y={30} h={34} fields={[{ label: "Type 8", w: 80, color: ICMP, strong: true }, { label: "Code 0", w: 80 }, { label: `Id ${ECHO_IDENTIFIER}`, w: 110, color: D.warning, strong: true }, { label: "Seq 1", w: 90, color: D.warning, strong: true }, { label: `Data ${PING_DATA} B`, w: 110 }]} />
      <text x={20} y={94} fill={D.success} fontSize={10.5} fontWeight={700}>
        Echo Reply (HOST-B → HOST-A)
      </text>
      <DFieldRow x={20} y={102} h={34} fields={[{ label: "Type 0", w: 80, color: D.success, strong: true }, { label: "Code 0", w: 80 }, { label: `Id ${ECHO_IDENTIFIER}`, w: 110, color: D.warning, strong: true }, { label: "Seq 1", w: 90, color: D.warning, strong: true }, { label: "same data", w: 110 }]} />
      <text x={510} y={90} fill={D.warning} fontSize={10}>
        copied →
      </text>
      <text x={510} y={106} fill={D.warning} fontSize={10}>
        how ping
      </text>
      <text x={510} y={122} fill={D.warning} fontSize={10}>
        matches replies
      </text>
    </DiagramSvg>
  );
}

function TraceDiagram() {
  const xs = [70, 240, 410, 580];
  const rows = [
    { ttl: 1, stop: 1, reply: `Time Exceeded 11/0 from ${IC_ADDR["R1:LAN"]}`, color: D.warning },
    { ttl: 2, stop: 2, reply: `Time Exceeded 11/0 from ${IC_ADDR["R2:TRANSIT"]}`, color: D.warning },
    { ttl: 3, stop: 3, reply: `Echo Reply 0/0 from ${IC_ADDR["HOST-B"]}`, color: D.success },
  ];
  return (
    <DiagramSvg h={250} label={`ICMP Echo-based traceroute: TTL 1 expires at R1 which sends Time Exceeded from ${IC_ADDR["R1:LAN"]}; TTL 2 expires at R2 from ${IC_ADDR["R2:TRANSIT"]}; TTL 3 reaches HOST-B which sends an Echo Reply`}>
      {["HOST-A", "R1", "R2", "HOST-B"].map((n, i) => (
        <text key={n} x={xs[i]} y={24} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
          {n}
        </text>
      ))}
      {xs.map((x) => (
        <line key={x} x1={x} y1={32} x2={x} y2={214} stroke={D.line} strokeDasharray="3 4" />
      ))}
      {rows.map((r, i) => {
        const y = 58 + i * 58;
        return (
          <g key={r.ttl}>
            <DArrow x1={xs[0]} y1={y} x2={xs[r.stop] - 6} y2={y} color={ICMP} label={`probe TTL ${r.ttl}`} />
            <DArrow x1={xs[r.stop] - 6} y1={y + 16} x2={xs[0] + 6} y2={y + 16} color={r.color} width={1.6} />
            <text x={xs[0] + 14} y={y + 30} fill={r.color} fontSize={9.5}>
              {r.reply}
            </text>
          </g>
        );
      })}
      <text x={20} y={238} fill={D.muted} fontSize={10}>
        Drawn with ICMP Echo probes (traceroute -I). Linux traceroute’s default uses UDP; the last hop then answers 3/3.
      </text>
    </DiagramSvg>
  );
}

function PmtuDiagram() {
  return (
    <DiagramSvg h={200} label={`A 1500-byte DF Echo Request reaches R1, whose link to R2 has an IP MTU of ${FAULT_MTU}; R1 drops it and returns ICMP Destination Unreachable Type 3 Code 4 with Next-Hop MTU ${FAULT_MTU}`}>
      <DNode x={80} y={80} label="HOST-A" accent={D.cyan} w={100} />
      <DNode x={320} y={80} label="R1" accent={D.ip} w={90} />
      <DNode x={560} y={80} label="R2" accent={D.ip} w={90} />
      <DArrow x1={132} y1={70} x2={273} y2={70} color={ICMP} label="1500 B · DF" />
      <DLink x1={367} y1={80} x2={513} y2={80} color={D.danger} dashed label={`IP MTU ${FAULT_MTU}`} />
      <DArrow x1={273} y1={94} x2={132} y2={94} color={D.warning} label="ICMP 3/4 · MTU 1400" labelDy={18} />
      <DPill x={320} y={150} text="1500 > 1400 and DF set → can't fragment → drop" color={D.danger} w={330} />
      <text x={20} y={188} fill={D.muted} fontSize={10}>
        Small pings (84 B) still pass: routing is fine. Only packets bigger than the path MTU with DF fail.
      </text>
    </DiagramSvg>
  );
}

function RepairMathDiagram() {
  const scale = 0.3;
  const x0 = 170;
  const bar = (y: number, data: number, label: string, ok: boolean) => (
    <g>
      <text x={20} y={y + 10} fill={D.text} fontSize={10.5} fontWeight={700}>
        {label}
      </text>
      <text x={20} y={y + 24} fill={ok ? D.success : D.danger} fontSize={10} fontFamily="monospace">
        20+8+{data} = {28 + data}
      </text>
      <rect x={x0} y={y} width={20 * scale} height={24} fill={D.ip} fillOpacity={0.6} />
      <rect x={x0 + 20 * scale} y={y} width={8 * scale} height={24} fill={ICMP} fillOpacity={0.7} />
      <rect x={x0 + 28 * scale} y={y} width={data * scale} height={24} fill={ok ? D.success : D.danger} fillOpacity={0.35} stroke={ok ? D.success : D.danger} />
    </g>
  );
  return (
    <DiagramSvg h={170} label={`20 + 8 + ${BIG_DATA} = 1500 bytes exceeds the ${FAULT_MTU}-byte MTU; 20 + 8 + ${FIXED_DATA} = 1400 bytes fits exactly; 20 + 8 + 1400 = 1428 does not`}>
      {bar(20, BIG_DATA, "original", false)}
      {bar(60, 1400, "data 1400", false)}
      {bar(100, FIXED_DATA, "data 1372", true)}
      <line x1={x0 + FAULT_MTU * scale} y1={10} x2={x0 + FAULT_MTU * scale} y2={134} stroke={D.warning} strokeWidth={2} strokeDasharray="5 4" />
      <text x={x0 + FAULT_MTU * scale} y={152} textAnchor="middle" fill={D.warning} fontSize={10} fontWeight={700}>
        IP MTU {FAULT_MTU}
      </text>
    </DiagramSvg>
  );
}

function LessonLabBridge() {
  const open = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the ICMP Lab" onPractice={open}>
      Same network, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

export function IcmpLessonGuideContent() {
  const pingOk = lessonCli(HEALTHY, "HOST-A", "cisco", `ping -c 2 ${B}`);
  const ttl1 = lessonCli(HEALTHY, "HOST-A", "cisco", `ping -c 1 -t 1 ${B}`);
  const traceOk = lessonCli(HEALTHY, "HOST-A", "cisco", `traceroute -I ${B}`);
  const netUnr = lessonCli(HEALTHY, "HOST-A", "cisco", "ping -c 1 10.20.30.40");
  const hostUnr = lessonCli(HEALTHY, "HOST-A", "cisco", "ping -c 1 198.51.100.99");
  const bigOk = lessonCli(HEALTHY, "HOST-A", "cisco", `ping -c 1 -s ${BIG_DATA} -M do ${B}`);
  const curlSmall = lessonCli(BROKEN, "HOST-A", "cisco", `curl -o /dev/null ${SMALL_URL}`);
  const curlBig = lessonCli(BROKEN, "HOST-A", "cisco", `curl -o /dev/null ${BIG_URL}`);
  const pingSmallBad = lessonCli(BROKEN, "HOST-A", "cisco", `ping -c 1 ${B}`);
  const bigBad = lessonCli(BROKEN, "HOST-A", "cisco", `ping -c 1 -s ${BIG_DATA} -M do ${B}`);
  const fitBad = lessonCli(BROKEN, "HOST-A", "cisco", `ping -c 1 -s ${FIXED_DATA} -M do ${B}`);
  const r2Sent = lessonCli(AFTER_DOWNLOAD, "R2", "cisco", "show ip traffic");
  const ipt = lessonCli(BROKEN, "HOST-B", "cisco", "sudo iptables -L INPUT -n --line-numbers");
  const curlFixed = lessonCli(FIXED, "HOST-A", "cisco", `curl -o /dev/null ${BIG_URL}`);
  const cacheFixed = lessonCli(FIXED, "HOST-B", "cisco", `ip route get ${IC_ADDR["HOST-A"]}`);
  const pingLines = /PING|bytes from|From|transmitted/;
  return (
    <div className="space-y-12">
      <GuideSection id="ic-mission" eyebrow="This lesson" title="What this lesson teaches" tone="violet">
        <p>
          HOST-A reaches the server HOST-B through two routers. When something goes wrong on that path, the routers and the server don&apos;t stay silent: they report back with small messages called <strong>ICMP</strong>. Ping and traceroute are built entirely on them.
        </p>
        <p>
          This lesson shows how to read those messages: you watch a ping go out and come back, a TTL run out at a router, traceroute map the path hop by hop, routers refuse packets they can&apos;t deliver, and a too-big packet get turned away. Then the small web page loads but the big download hangs, and you find out why, fix it, and prove it.
        </p>
        <ChecklistCard
          tone="violet"
          title="By the end of this lesson you can"
          mark="→"
          items={[
            "say what a ping reply proves, and what it doesn't",
            "read Time Exceeded, Net, Host and Port Unreachable, and say who sent each and why",
            "explain how traceroute finds each router, and why * * * isn't proof of failure",
            "explain DF, the MTU and the Fragmentation Needed message, and find a path's MTU with ping",
            "find and repair the black hole of this lesson, and prove it",
          ]}
        />
      </GuideSection>

      <GuideSection id="ic-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <FieldTable
          title="The path"
          columns={["Device", "Address", "Role"]}
          rows={[
            ["HOST-A (Linux)", `${IC_ADDR["HOST-A"]}/24`, "The client: ping, traceroute, curl"],
            ["R1", `${IC_ADDR["R1:LAN"]} (LAN) · ${IC_ADDR["R1:TRANSIT"]} (to R2)`, "HOST-A's gateway, static route to HOST-B's network"],
            ["R2", `${IC_ADDR["R2:TRANSIT"]} (to R1) · ${IC_ADDR["R2:LAN"]} (LAN)`, "HOST-B's gateway, static route back"],
            ["HOST-B (Linux)", `${B}/24`, "The server: a status page and a 50 MB file"],
          ]}
        />
        <p className="text-sm text-pv-text-muted">
          R1 and R2 are joined by a /30 transit link. Every link carries 1500-byte IPv4 packets (the MTU) until the incident. On Cisco the routers&apos; LAN ports are Gi0/0 and the transit ports Gi0/1; on Junos, ge-0/0/0 and ge-0/0/1.
        </p>
      </GuideSection>

      <GuideSection id="ic-ideas" eyebrow="This lesson" title="Three ideas you need" tone="cyan">
        <FlowSteps
          steps={[
            { title: "ICMP is how the network talks back", body: "A router or host that drops a packet usually sends an ICMP message to the sender, saying why. Ping uses ICMP on purpose: a request that asks for a reply.", tone: "violet" },
            { title: "Who sent it matters as much as what it says", body: "The source address of the ICMP message is the device that gave up. That tells you where on the path the problem was seen.", tone: "warning" },
            { title: "Silence is evidence too", body: "No reply at all means something dropped the packet, or the answer, without a word: a firewall, a missing route back, a switched-off host.", tone: "danger" },
          ]}
        />
      </GuideSection>

      <GuideSection id="ic-walk" eyebrow="This lesson" title="What you will watch, step by step" tone="warning">
        <FlowSteps
          steps={[
            { title: "Ping", body: "An Echo Request out, an Echo Reply back, two routers crossed.", tone: "violet" },
            { title: "Time Exceeded", body: "A packet sent with TTL 1 dies at R1, and R1 says so.", tone: "warning" },
            { title: "Traceroute", body: "TTL 1, 2, 3: each router reveals itself in turn.", tone: "cyan" },
            { title: "Unreachable", body: "R1 has no route, R2 finds nobody: two different refusals.", tone: "danger" },
            { title: "Size", body: "A full-size packet with DF set crosses the healthy path.", tone: "ip" },
            { title: "The incident", body: "Small pages load, big downloads hang. You find out why and fix it.", tone: "danger" },
          ]}
        />
        <p className="text-sm text-pv-text-muted">The sections below walk through each step on this network, in the same order.</p>
      </GuideSection>

      <GuideSection id="ic-position" eyebrow="ICMP" title="ICMP rides inside IPv4" tone="violet">
        <p>
          ICMP is not a separate layer with ports: it is carried directly inside an IPv4 packet, with Protocol number 1. Every message starts with a <strong>type</strong> and a <strong>code</strong> that say what it means (8/0 Echo Request, 0/0 Echo Reply, 11/0 Time Exceeded, 3/x Destination Unreachable), followed by a checksum.
        </p>
        <DiagramFrame caption="An Echo Request on the wire: no TCP, no UDP, no ports.">
          <PositionDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ic-ping" eyebrow="Ping" title="Ping: an Echo Request and its Echo Reply" tone="violet">
        <p>
          <Mono>ping</Mono> sends an Echo Request to HOST-B. HOST-B answers with an Echo Reply: a brand-new packet, which starts its own trip back with its own TTL. Each router lowers the TTL on the way, so HOST-B&apos;s reply arrives at HOST-A with {INITIAL_TTL} − 2 = {INITIAL_TTL - 2}:
        </p>
        <DiagramFrame caption="Routers decrement the TTL in both directions; the destination starts a fresh one.">
          <PingDiagram />
        </DiagramFrame>
        <CliPanel run={{ ...pingOk, output: pickLines(pingOk.output, pingLines) }} caption="HOST-A · Linux" />
        <p>Ping matches each reply to its request by the Identifier and Sequence number the reply copies back. A reply proves that the request reached HOST-B <em>and</em> that HOST-B&apos;s answer found its way back: both directions work. It says nothing about TCP ports, large packets or applications.</p>
        <DiagramFrame caption="The reply copies the request's Identifier, Sequence and data.">
          <EchoMatchDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ic-ttl" eyebrow="Time Exceeded" title="When the TTL runs out: Time Exceeded" tone="warning">
        <p>
          Each router lowers the TTL by one and must drop a packet whose TTL would reach zero. When it does, it sends the sender an ICMP <strong>Time Exceeded</strong> (11/0), from its own address. Send a ping with TTL 1 and R1 is the router that drops it:
        </p>
        <CliPanel run={{ ...ttl1, output: pickLines(ttl1.output, pingLines) }} caption="HOST-A · TTL 1 dies at R1" />
        <p>The error comes from <Mono>{IC_ADDR["R1:LAN"]}</Mono>: R1&apos;s address on the side facing HOST-A. That one detail is all traceroute needs.</p>
      </GuideSection>

      <GuideSection id="ic-trace" eyebrow="Traceroute" title="Traceroute: TTL 1, 2, 3" tone="cyan">
        <p>Traceroute sends probes with TTL 1, then 2, then 3. The first dies at R1, the second at R2, each router answering Time Exceeded from its own address; the third reaches HOST-B, which answers like a destination:</p>
        <DiagramFrame caption="Each TTL reveals one more hop.">
          <TraceDiagram />
        </DiagramFrame>
        <CliPanel run={traceOk} caption="HOST-A · ICMP probes" />
        <Callout tone="cyan" title="Two kinds of probe, same trick" icon="→">
          <Mono>traceroute -I</Mono> sends Echo Requests, so the last hop answers with an Echo Reply. Plain <Mono>traceroute</Mono> on Linux sends UDP to unlikely ports, so the last hop answers Port Unreachable (3/3). Both rely on Time Exceeded for every hop in between.
        </Callout>
      </GuideSection>

      <GuideSection id="ic-unreach" eyebrow="Unreachable" title="Destination Unreachable: who says no, and why" tone="danger">
        <p>When a device can&apos;t deliver a packet, it sends Destination Unreachable (type 3). The code says why, and the source says where:</p>
        <CliPanel run={{ ...netUnr, output: pickLines(netUnr.output, pingLines) }} caption="HOST-A · a network nobody routes" />
        <CliPanel run={{ ...hostUnr, output: pickLines(hostUnr.output, pingLines) }} caption="HOST-A · an address nobody has, on HOST-B's LAN" />
        <FieldTable
          title="Reading an unreachable"
          columns={["Message", "Sent by", "Means"]}
          rows={[
            ["3/0 Net Unreachable", "a router (here R1)", "No route to the destination's network"],
            ["3/1 Host Unreachable", "the last router (here R2)", "The network is right, but nobody answers ARP for that address"],
            ["3/3 Port Unreachable", "the destination host", "The host is there; nothing listens on that UDP port"],
            ["3/4 Fragmentation Needed", "a router", "Too big for the next link, and DF forbids splitting it"],
          ]}
        />
      </GuideSection>

      <GuideSection id="ic-silence" eyebrow="Silence" title="Silence is evidence too" tone="danger">
        <p>Not every failure sends a message. A host&apos;s firewall can drop Echo Requests, a router can have no route <em>back</em>, a router can be told not to send Time Exceeded. Each leaves a different pattern of silence, and an error message, when there is one, always beats a guess:</p>
        <CompareCards
          items={[
            { title: "An error came back", tone: "warning", tag: "someone gave up", points: ["The source address names the device", "The type and code name the reason", "Everything before that device worked"] },
            { title: "Nothing came back", tone: "danger", tag: "something dropped it", points: ["The request, or the answer, was lost without a word", "Compare tools: does curl or a UDP traceroute get through?", "Check both directions: the way back fails just as quietly"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="ic-pmtu" eyebrow="Size" title="Size, MTU and the DF bit" tone="ip">
        <p>
          Every link has an <strong>MTU</strong>: the largest IPv4 packet it carries, 1500 bytes here. A packet can carry the <strong>DF</strong> (Don&apos;t Fragment) flag; modern hosts set it on almost everything. A router that receives a DF packet too big for the next link must drop it, and sends back <strong>Fragmentation Needed</strong> (3/4) with the next link&apos;s MTU. The sender lowers its packet size for that destination and tries again: that loop is <strong>Path MTU Discovery</strong>.
        </p>
        <p>On the healthy path a full 1500-byte packet with DF set crosses every link (<Mono>-s {BIG_DATA}</Mono> is the ICMP data: 20 + 8 + {BIG_DATA} = 1500 bytes of IPv4):</p>
        <CliPanel run={{ ...bigOk, output: pickLines(bigOk.output, pingLines) }} caption="HOST-A · 1500 bytes, DF set" />
        <p>
          Path MTU Discovery only works if the 3/4 message actually gets back to the sender of the big packet. Nobody checks that it does. Keep that in mind: it is the key to the incident.
        </p>
      </GuideSection>

      <GuideSection id="ic-verify" eyebrow="Verification" title="What working looks like" tone="success">
        <p>Each idea of this lesson has one probe that proves it. The commands are only the way to ask; what matters is what each answer proves.</p>
        <FieldTable
          title="Read the path with ICMP"
          columns={["Question", "From a Linux host", "From a router (Cisco / Junos)", "What the answer proves"]}
          rows={[
            ["Do both directions work?", <Mono key="1">ping</Mono>, <Mono key="2">ping</Mono>, "A reply needs the request and the answer to arrive"],
            ["Which routers are on the path?", <Mono key="3">traceroute -I</Mono>, <Mono key="4">traceroute</Mono>, "Each hop answers Time Exceeded from its own address"],
            ["How big can a packet be?", <Mono key="5">ping -s N -M do</Mono>, <Mono key="6">ping … size N df-bit / do-not-fragment</Mono>, "The largest size that passes is the path MTU"],
            ["Which ICMP did a router send?", "—", <Mono key="7">show ip traffic / show system statistics icmp</Mono>, "Counters of every message sent and received"],
          ]}
        />
        <p>On the healthy path, HOST-A&apos;s ping and traceroute both reach HOST-B, two routers away, and a full-size DF packet crosses (all shown above).</p>
      </GuideSection>

      <GuideSection id="ic-incident" eyebrow="Incident" title="The incident: big downloads hang" tone="danger">
        <p>
          The user says: &quot;The status page on HOST-B loads instantly. Downloading the big file just sits at 0 bytes and never fails with an error.&quot; The provider has moved the R1–R2 circuit to a service that carries 1400-byte packets, and the server team blocks ICMP unreachables on HOST-B. Ping works.
        </p>
        <DiagramFrame caption={`A 1500-byte DF packet meets the ${FAULT_MTU}-byte link. The router drops it and reports 3/4: whether that report is heard decides everything.`}>
          <PmtuDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "What should happen", tone: "success", tag: "normal", points: ["HOST-B sends full-size packets with DF", `R2 drops the first one and sends HOST-B 3/4, MTU ${FAULT_MTU}`, "HOST-B resends smaller packets, and the download flows"] },
            { title: "What happens", tone: "danger", tag: "incident", points: ["HOST-B sends full-size packets with DF", "R2 drops them and sends 3/4", "HOST-B's firewall drops the 3/4, so HOST-B keeps resending 1500-byte packets"] },
          ]}
        />
        <CompareCards
          items={[
            { title: "Why it fails", tone: "danger", tag: "cause", points: [`The R1–R2 link carries ${FAULT_MTU}-byte packets`, "HOST-B drops ICMP 3/4, so Path MTU Discovery can't work", "Every large packet vanishes: a black hole"] },
            { title: "What it can't be", tone: "warning", tag: "red herrings", points: ["Routing: ping and the small page work", "HOST-B down: it answers", "The web server: small files download fine"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="ic-investigate" eyebrow="Investigation" title="Find the size that fails, then who isn't listening" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "What works, what doesn't?", look: "Small things (ping, the status page) work; the big download hangs without an error. That pattern points at size." },
            { question: "How big can a packet be?", look: `ping with DF: 1500 bytes is refused by R1 with 3/4, MTU ${FAULT_MTU}; 1400 bytes passes.` },
            { question: "Who never hears the 3/4?", look: "R2 sent one toward HOST-B; HOST-B's firewall drops type 3 code 4." },
          ]}
        />
        <CliPanel run={{ ...curlSmall, output: pickLines(curlSmall.output, /100|curl/) }} caption="HOST-A · the small page" />
        <CliPanel run={{ ...curlBig, output: pickLines(curlBig.output, /curl|0 50/) }} caption="HOST-A · the big file" />
        <CliPanel run={{ ...pingSmallBad, output: pickLines(pingSmallBad.output, pingLines) }} caption="HOST-A · a small ping still works" />
        <CliPanel run={{ ...bigBad, output: pickLines(bigBad.output, pingLines) }} caption="HOST-A · 1500 bytes with DF" />
        <DiagramFrame caption={`The arithmetic: 20 (IPv4) + 8 (ICMP) + data must fit in ${FAULT_MTU}.`}>
          <RepairMathDiagram />
        </DiagramFrame>
        <CliPanel run={{ ...fitBad, output: pickLines(fitBad.output, pingLines) }} caption={`HOST-A · ${FAULT_MTU} bytes with DF`} />
        <p>HOST-A heard R1&apos;s 3/4 and adapted. The download goes the other way: HOST-B sends the big packets, so R2 is the router that drops them, and HOST-B must hear R2. R2 did send it; HOST-B threw it away:</p>
        <CliPanel run={{ ...r2Sent, output: pickLines(r2Sent.output, /Sent:/) }} caption="R2 · Cisco IOS · after the download attempt" />
        <CliPanel run={ipt} caption="HOST-B · its firewall" />
      </GuideSection>

      <GuideSection id="ic-repair" eyebrow="Repair" title="Repair, and prove it with a fresh download" tone="success">
        <p>
          The link MTU is the provider&apos;s and is legitimate. What breaks the network is the rule that blinds HOST-B to it. Remove it: <Mono>sudo iptables -D INPUT 1</Mono> on HOST-B (in production, allow at least type 3 code 4 rather than all ICMP). Then download again:
        </p>
        <CliPanel run={{ ...curlFixed, output: pickLines(curlFixed.output, /100|curl/) }} caption="HOST-A · after the repair" />
        <CliPanel run={cacheFixed} caption="HOST-B · it learned the path MTU" />
        <ChecklistCard
          tone="success"
          title="The proof"
          mark="✓"
          items={[
            "The big file downloads completely",
            `HOST-B's route cache to HOST-A shows mtu ${FAULT_MTU}: it heard the 3/4 and adapted`,
            "Ping and the status page were never affected",
            "The provider's 1400-byte link is unchanged: nothing on R1 or R2 had to move",
          ]}
        />
      </GuideSection>

      <GuideSection id="ic-other" eyebrow="Troubleshooting" title="Other ways ICMP tells you what broke" tone="warning">
        <p>The black hole is one pattern. The lab&apos;s tickets add five more, each with its own signature. The Deep Dive walks through all six with real output from the hosts and both routers.</p>
        <CompareCards
          items={[
            { title: "HOST-B switched off", tone: "danger", tag: "!H from R2", points: ["Destination Host Unreachable, from R2", "traceroute ends with !H at R2", "R2 got the packet; nobody answered its ARP"] },
            { title: "No route back", tone: "warning", tag: "only R1 answers", points: ["Ping: silence, no error", "traceroute: R1, then * * * for ever", "R2 has no route to HOST-A's network"] },
            { title: "A routing loop", tone: "danger", tag: "TTL dies", points: ["Ping prints Time to live exceeded", "traceroute alternates R1, R2, R1, R2…", "Each router sends the packet back to the other"] },
            { title: "A hidden hop", tone: "cyan", tag: "* * * but it works", points: ["traceroute shows * * * at hop 2", "Ping and the app work fine", "A filter drops Time Exceeded, not traffic"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="ic-model" eyebrow="Mental model" title="Postcards from the road" tone="cyan">
        <p>
          Every packet travels with a fuel gauge (the TTL) and a size label. When a router has to turn a packet away (out of fuel, no road, too wide for the next bridge), it mails a postcard back to the sender, signed with its own address and saying why. Ping is a postcard you ask for on purpose; traceroute deliberately runs packets out of fuel one router further each time, to collect a postcard from every stop. If the postcards are thrown away on arrival, the sender keeps driving the same oversized truck at the same bridge, and nobody ever says why it never arrives.
        </p>
      </GuideSection>

      <GuideSection id="ic-glossary" eyebrow="Glossary" title="Terms used in this lesson" tone="violet">
        <Glossary
          items={[
            { term: "ICMP", def: "Internet Control Message Protocol: IPv4 Protocol 1, for errors and tests." },
            { term: "Echo Request / Reply", def: "Types 8 and 0: the two halves of a ping." },
            { term: "Time Exceeded", def: "Type 11 code 0: a router dropped a packet whose TTL ran out." },
            { term: "Destination Unreachable", def: "Type 3: codes 0 net, 1 host, 3 port, 4 fragmentation needed." },
            { term: "MTU", def: "The largest IPv4 packet a link carries, header included." },
            { term: "DF", def: "Don't Fragment: a router may not split the packet; it must drop it and report 3/4." },
            { term: "PMTU black hole", def: "Large packets vanish because the 3/4 messages never reach their sender." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ic-recap" eyebrow="Recap" title="What you can now explain" tone="success">
        <ChecklistCard
          tone="cyan"
          title="ICMP in this lesson"
          mark="→"
          items={[
            "A ping reply proves both directions, for small ICMP packets only",
            "Time Exceeded comes from the router where the TTL ran out; traceroute uses that hop by hop",
            "Net Unreachable: a router has no route. Host Unreachable: the last router found nobody",
            "The source of an ICMP message tells you where the problem was seen",
            "A DF packet too big for a link is dropped and reported with 3/4 and the link's MTU",
            "Block that 3/4 and large transfers hang without an error: a black hole",
          ]}
        />
      </GuideSection>

      <GuideSection id="ic-practice" eyebrow="Practice" title="Practice it" tone="cyan">
        <p>You now know what each ICMP message means and who sends it. The ICMP Lab gives you this network with Linux hosts and Cisco or Junos routers:</p>
        <FlowSteps
          steps={[
            { title: "Learn (6 levels)", body: "One ping, TTL and Time Exceeded, traceroute, when delivery fails, size/MTU/DF, silence is evidence.", tone: "violet" },
            { title: "Probe and follow", body: "Send any ping, traceroute or download and follow every packet and every ICMP reply across the topology and the captures.", tone: "warning" },
            { title: "Troubleshoot (6 tickets)", body: "This lesson's incident and the five other patterns above, reported as users report them.", tone: "danger" },
          ]}
        />
        <PresentationBridge>Watch ping, TTL expiry, traceroute and the MTU black hole animated in the ICMP presentation.</PresentationBridge>
        <LessonLabBridge />
        <p className="text-sm text-pv-text-muted">For the full course (every message type and its layout, the error rules, traceroute variants, the PMTUD loop, real output for every ticket, a knowledge check), open the Deep Dive tab.</p>
      </GuideSection>
    </div>
  );
}
