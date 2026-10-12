import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, FailureSignatures, FieldTable, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { SeqLanes } from "@/components/lesson/TroubleshootingGuideSvg";
import { FAULT_PREFIX, GOOD_PREFIX, L3, L3_MAC, maskOf, networkOf } from "@/lib/sim-engine/scenarios/troubleshootingLayer3";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import { createL3Net, l3Apply, l3Ticket, l3TicketState, testOk, testText, type L3Action, type L3D, type L3State, type L3TicketId } from "@/lib/sim-engine/scenarios/l3tsNet";
import { l3Sets, l3StaticApi } from "./l3-lab/l3Cli";

export const L3_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "l3l-mission", label: "What this lesson teaches" },
  { id: "l3l-network", label: "The network of this lesson" },
  { id: "l3l-ideas", label: "Three ideas you need" },
  { id: "l3l-watch", label: "What you will watch" },
  { id: "l3l-decide", label: "The host decides first" },
  { id: "l3l-arp", label: "ARP finds the next hop" },
  { id: "l3l-frame", label: "Two addresses, two layers" },
  { id: "l3l-routers", label: "Routers, hop by hop" },
  { id: "l3l-working", label: "What working looks like" },
  { id: "l3l-incident", label: "The incident" },
  { id: "l3l-decision", label: "What CLIENT decides now" },
  { id: "l3l-arpfail", label: "An ARP nobody answers" },
  { id: "l3l-r1", label: "R1's side of the story" },
  { id: "l3l-repair", label: "Repair and proof" },
  { id: "l3l-other", label: "Other ways it breaks" },
  { id: "l3l-model", label: "Mental model" },
  { id: "l3l-glossary", label: "Glossary" },
  { id: "l3l-recap", label: "Recap" },
  { id: "l3l-practice", label: "Practice it" },
];

/** Real Linux and Junos output on this page comes from the Layer 3 Lab. */
const run = (s: L3State, ...a: L3Action[]) => a.reduce((acc, x) => l3Apply(acc, x), s);
export const l3TicketRun = (id: L3TicketId) => l3Ticket(id).repro.reduce((acc, a) => l3Apply(acc, a), l3TicketState(id, 1));
export const pS: L3Action = { type: "ping", from: "CLIENT", dst: L3.server, count: 4 };
export const pR: L3Action = { type: "ping", from: "CLIENT", dst: L3.remote, count: 4 };
export const L3G = run(createL3Net(0), pS, pR, { type: "trace", from: "CLIENT", dst: L3.remote });
export const L3_INC = l3TicketRun("mask");
export const L3_FIX = run(L3_INC, { type: "host", dev: "CLIENT", cfg: { addrs: [{ ip: L3.client, len: 24 }], gw: L3.gw }, text: "10.10.10.10/24 + default via 10.10.10.1" }, pS, pR);
export function l3Cli(s: L3State, d: L3D, command: string) {
  return runGuideCli(l3Sets(l3StaticApi(s, d), d).juniper, command);
}
export function l3Only(s: L3State, d: L3D, command: string, match: RegExp, keep = 0) {
  const x = l3Cli(s, d, command);
  return { ...x, output: pickLines(x.output, match, keep) };
}
/** Tests as the lab reports them (from test `from` on). */
export function L3Result({ s, title, from = 0 }: { s: L3State; title: string; from?: number }) {
  const ts = s.tests.slice(from);
  const ok = ts.every(testOk);
  return (
    <Callout tone={ok ? "success" : "danger"} title={title} icon={ok ? "✓" : "!"}>
      {ts.map(testText).join(" · ")}
    </Callout>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the Layer 3 Lab" onPractice={openLab}>
      The lesson&apos;s network live: CLIENT&apos;s routing decision, every ARP cache, both routers&apos; tables, ping and traceroute hop by hop, Junos and Linux consoles — your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

function TopologyDiagram() {
  return (
    <DiagramSvg h={200} label="CLIENT on 10.10.10.0/24 behind SW1 and R1; R1 to R2 over 192.0.2.0/31; SERVER 10.20.20.20 and REMOTE-SERVER 10.10.20.20 behind R2">
      <DNode x={60} y={120} label="CLIENT" sub={`${L3.client}/${GOOD_PREFIX}`} accent={D.cyan} w={110} />
      <DNode x={190} y={60} label="SW1" sub="access" accent={D.eth} w={80} />
      <DNode x={300} y={120} label="R1" sub={L3.gw} accent={D.violet} w={90} />
      <DNode x={430} y={60} label="R2" sub={L3.r2T} accent={D.violet} w={90} />
      <DNode x={570} y={30} label="SERVER" sub={L3.server} accent={D.success} w={110} />
      <DNode x={570} y={150} label="REMOTE-SERVER" sub={L3.remote} accent={D.success} w={130} />
      <DLink x1={100} y1={104} x2={160} y2={76} />
      <DLink x1={220} y1={76} x2={270} y2={104} />
      <DLink x1={340} y1={104} x2={395} y2={76} />
      <DLink x1={475} y1={50} x2={515} y2={36} label=".20.1" />
      <DLink x1={475} y1={74} x2={505} y2={138} label="10.10.20.1" labelDy={14} />
      <text x={320} y={190} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        R1 ↔ R2 over 192.0.2.0/31. Both servers are remote from CLIENT — reached through R1 and R2.
      </text>
    </DiagramSvg>
  );
}

function DecisionDiagram() {
  return (
    <DiagramSvg h={170} label="Local or remote: 10.10.20.20 AND 255.255.255.0 gives 10.10.20.0, not equal to CLIENT's 10.10.10.0, so remote; via the gateway">
      <DTable
        x={50}
        y={8}
        title={`CLIENT ${L3.client}/${GOOD_PREFIX} → destination ${L3.remote}`}
        cols={[
          { label: "STEP", w: 210 },
          { label: "VALUE", w: 330 },
        ]}
        rows={[
          ["CLIENT's network", `${L3.client} AND ${maskOf(GOOD_PREFIX)} = ${networkOf(L3.client, GOOD_PREFIX)}`],
          ["Destination's network", `${L3.remote} AND ${maskOf(GOOD_PREFIX)} = ${networkOf(L3.remote, GOOD_PREFIX)}`],
          ["Same network?", "no → remote"],
          ["Next hop", `gateway ${L3.gw}`],
        ]}
        highlight={{ row: 3, color: D.success }}
      />
    </DiagramSvg>
  );
}

function ArpDiagram() {
  const f = (label: string, sub: string, w: number, color: string, strong?: boolean) => ({ label, sub, w, color, strong });
  return (
    <DiagramSvg h={130} label="ARP request for the gateway: Ethernet destination broadcast, target IP 10.10.10.1, target MAC all zeros">
      <DFieldRow x={20} y={14} fields={[f("Eth dst", "FF:FF:FF:FF:FF:FF", 130, D.eth, true), f("Eth src", "CLIENT", 80, D.eth), f("Type", "0x0806", 60, D.eth), f("Op", "1 request", 70, D.warning), f("Sender", `${L3.client}`, 100, D.warning), f("Target MAC", "00:…:00", 80, D.warning), f("Target IP", L3.gw, 80, D.warning, true)]} />
      <text x={320} y={100} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        The target is the NEXT HOP — for a remote destination, the gateway. The unknown target MAC is all zeros.
      </text>
    </DiagramSvg>
  );
}

function TwoDestinationsDiagram() {
  const f = (label: string, sub: string, w: number, color: string, strong?: boolean) => ({ label, sub, w, color, strong });
  return (
    <DiagramSvg h={140} label="The echo leaving CLIENT: Ethernet destination is R1's MAC, IPv4 destination is 10.10.20.20">
      <DFieldRow x={20} y={14} fields={[f("Eth dst", `${L3_MAC.R1_LAN} (R1)`, 170, D.eth, true), f("Eth src", "CLIENT", 80, D.eth), f("IPv4 src", L3.client, 110, D.ip), f("IPv4 dst", L3.remote, 110, D.ip, true), f("TTL", "64", 50, D.ip), f("ICMP", "echo", 60, D.warning)]} />
      <text x={320} y={98} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
        Ethernet says &quot;next hop&quot;; IPv4 says &quot;final destination&quot;.
      </text>
      <text x={320} y={118} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        At every router the Ethernet addresses are rewritten; the IP addresses are not.
      </text>
    </DiagramSvg>
  );
}

function TtlDiagram() {
  return (
    <DiagramSvg h={130} label="TTL 64 leaving CLIENT, unchanged through SW1, 63 after R1, 62 after R2">
      {[
        { x: 70, n: "CLIENT", t: "TTL 64", c: D.cyan },
        { x: 210, n: "SW1", t: "TTL 64 (switch)", c: D.eth },
        { x: 360, n: "R1", t: "TTL 63", c: D.violet },
        { x: 510, n: "R2", t: "TTL 62", c: D.violet },
      ].map((h, i, all) => (
        <g key={h.n}>
          <DNode x={h.x} y={55} label={h.n} sub={h.t} accent={h.c} w={120} />
          {i < all.length - 1 && <DArrow x1={h.x + 62} y1={55} x2={all[i + 1].x - 62} y2={55} color={D.muted} width={1.4} />}
        </g>
      ))}
      <text x={320} y={112} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Only routing hops decrement TTL (and recompute the header checksum). The reply arrives with TTL 62 the other way.
      </text>
    </DiagramSvg>
  );
}

function ScopeDiagram() {
  return (
    <DiagramSvg h={130} label="During the incident, 10.20.20.20 is reachable and 10.10.20.20 is not, although both are behind R2">
      <DTable
        x={60}
        y={8}
        title="Scope the symptom: same path, different outcome"
        cols={[
          { label: "DESTINATION", w: 150 },
          { label: "BEHIND", w: 90 },
          { label: "RESULT", w: 280 },
        ]}
        rows={[
          [L3.server, "R2", "5/5 via the gateway"],
          [L3.remote, "R2", "0/5 · Destination Host Unreachable (from CLIENT)"],
        ]}
        highlight={{ row: 1, color: D.danger }}
      />
    </DiagramSvg>
  );
}

function LpmDiagram() {
  return (
    <DiagramSvg h={150} label="With /16, CLIENT's table holds 10.10.0.0/16 connected and 0.0.0.0/0 via 10.10.10.1; for 10.10.20.20 both match and the /16 wins">
      <DTable
        x={60}
        y={8}
        title={`CLIENT with /${FAULT_PREFIX} — lookup for ${L3.remote}`}
        cols={[
          { label: "ROUTE", w: 260 },
          { label: "MATCHES?", w: 110 },
          { label: "LENGTH", w: 150 },
        ]}
        rows={[
          [`${networkOf(L3.client, FAULT_PREFIX)}/${FAULT_PREFIX} connected (on-link)`, "yes", `${FAULT_PREFIX} ← wins`],
          [`0.0.0.0/0 via ${L3.gw}`, "yes", "0 — never consulted"],
        ]}
        highlight={{ row: 0, color: D.warning }}
      />
      <text x={320} y={118} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        {L3.server} is outside 10.10.0.0/16, so only the default route matches it — which is why that server still works.
      </text>
    </DiagramSvg>
  );
}

function BrokenDiagram() {
  return (
    <DiagramSvg h={160} label="Broken attempt: CLIENT broadcasts ARP for 10.10.20.20 three times; R1 hears it but does not answer; no IPv4 packet is sent">
      <SeqLanes
        lanes={[
          { x: 120, label: "CLIENT", color: D.cyan },
          { x: 330, label: "SW1", color: D.eth },
          { x: 530, label: "R1", color: D.violet },
        ]}
        msgs={[
          { from: 0, to: 2, label: `ARP who-has ${L3.remote} ×3`, sub: "broadcast · flooded by SW1", color: D.warning },
          { from: 2, to: 0, label: "(no reply — not R1's address)", drop: true },
          { from: 0, to: 2, label: "no IPv4 packet ever sent", color: D.faint },
        ]}
      />
    </DiagramSvg>
  );
}

function R1Diagram() {
  return (
    <DiagramSvg h={130} label="R1's view of the failed attempt: 3 ARP requests heard for someone else's address, 0 IPv4 packets, route to 10.10.20.0/24 present">
      <DTable
        x={80}
        y={8}
        title="R1 during the failed ping"
        cols={[
          { label: "EVIDENCE", w: 280 },
          { label: "VALUE", w: 200 },
        ]}
        rows={[
          [`ARP requests heard for ${L3.remote}`, "3 (not mine · proxy ARP off)"],
          [`IPv4 packets ${L3.client} → ${L3.remote}`, "0"],
          ["Route to 10.10.20.0/24", "present · via 192.0.2.1"],
        ]}
      />
    </DiagramSvg>
  );
}

function VerifyDiagram() {
  return (
    <DiagramSvg h={170} label="Broken versus repaired: ARP target 10.10.20.20 becomes 10.10.10.1, no IPv4 packet becomes an echo to R1's MAC with IPv4 destination 10.10.20.20, 0 of 5 becomes 5 of 5">
      <DTable
        x={30}
        y={8}
        title="Same host, same destination, before and after"
        cols={[
          { label: "", w: 170 },
          { label: `BROKEN /${FAULT_PREFIX}`, w: 200 },
          { label: `REPAIRED /${GOOD_PREFIX}`, w: 210 },
        ]}
        rows={[
          ["Route chosen", `${networkOf(L3.client, FAULT_PREFIX)}/${FAULT_PREFIX} connected`, "0.0.0.0/0 via gateway"],
          ["ARP target", L3.remote, L3.gw],
          ["Ethernet dst of echo", "— (never sent)", `${L3_MAC.R1_LAN} (R1)`],
          ["IPv4 dst", L3.remote, `${L3.remote} (unchanged)`],
          ["Ping", "0/5", "5/5"],
        ]}
        highlight={{ row: 2, color: D.success }}
      />
    </DiagramSvg>
  );
}


const T = { gateway: l3TicketRun("gateway"), noroute: l3TicketRun("noroute"), return: l3TicketRun("return"), loop: l3TicketRun("loop") };

export function L3LessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="l3l-mission" eyebrow="This lesson" title="What this lesson teaches" tone="cyan">
        <p>
          “The server is unreachable” sends people straight to the router. But before any router sees a packet, the sending host has already made the most important decision: is the destination on my own network, or do I send it to my gateway? Get that wrong and the router never even hears about the packet. This lesson answers: <b className="text-pv-text">how do you follow a packet&apos;s journey decision by decision — host, ARP, router, router — and find the one that&apos;s wrong?</b>
        </p>
        <p>You will see how a host&apos;s address, prefix length and default route build its routing table, how ARP resolves only the next hop, why the Ethernet and IP destinations differ, and how routers forward hop by hop. Then you will chase the guided lesson&apos;s incident — one server reachable, one not, behind the same router — and prove the repair.</p>
        <ChecklistCard tone="cyan" title="By the end of this lesson you can" mark="→" items={["predict a host's on-link/gateway decision from its address, prefix and default route", "say whose MAC a host ARPs for, and why", "read a router's routing table and a traceroute", "tell the sender's own errors from a router's, and both from silence", "find a wrong prefix length, gateway, missing route, missing return route or loop", "prove a repair with fresh pings in both directions"]} />
      </GuideSection>

      <GuideSection id="l3l-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="The guided lesson's topology.">
          <TopologyDiagram />
        </DiagramFrame>
        <p>
          CLIENT (<Mono>{L3.client}/{GOOD_PREFIX}</Mono>) sits behind switch SW1 on a LAN with R1 (<Mono>{L3.gw}</Mono>). R1 and R2 share a /31 transit link (<Mono>192.0.2.0/31</Mono>). Behind R2: SERVER (<Mono>{L3.server}</Mono>, 10.20.20.0/24) and REMOTE-SERVER (<Mono>{L3.remote}</Mono>, 10.10.20.0/24). Note how similar 10.10.20.20 looks to CLIENT&apos;s own 10.10.10.10 — that matters later.
        </p>
        <Callout tone="cyan" title="The lesson and the lab" icon="i">
          The guided lesson walks the incident byte by byte on these devices. The lab runs the same network live: R1 and R2 are Junos routers with static routes, the hosts are Linux with <Mono>ip addr</Mono>, <Mono>ip route</Mono>, <Mono>ip route get</Mono>, <Mono>ip neigh</Mono>, <Mono>ping</Mono> and <Mono>traceroute</Mono>. Every packet is walked as the devices would — longest-prefix match, ARP per segment, TTL, ICMP errors back to the source. Outputs below come from the lab.
        </Callout>
      </GuideSection>

      <GuideSection id="l3l-ideas" eyebrow="This lesson" title="Three ideas you need" tone="violet">
        <CompareCards
          items={[
            { title: "The host decides", tone: "cyan", tag: "its own table", points: ["address + prefix → connected route", "gateway → default route; longest wins"] },
            { title: "ARP the next hop", tone: "violet", tag: "Layer 2", points: ["frame to the next hop's MAC", "IP destination stays the final host"] },
            { title: "Hop by hop", tone: "success", tag: "routers", points: ["look up, TTL − 1, resolve next hop", "errors go back to the source"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="l3l-watch" eyebrow="This lesson" title="What you will watch" tone="cyan">
        <TroubleshootingFlow
          steps={[
            { question: "A healthy network", look: L3G.tests.slice(0, 2).map(testText).join(" · ") },
            { question: "The incident", look: L3_INC.tests.map(testText).join(" · ") },
            { question: "CLIENT's decision", look: "10.10.20.20 now matches CLIENT's own connected route" },
            { question: "The evidence", look: "a FAILED ARP on CLIENT; R1 heard a request “not for me” and never saw an IPv4 packet" },
            { question: "Repair and proof", look: "10.10.10.10/24 + default route → both servers answer" },
          ]}
        />
      </GuideSection>

      <GuideSection id="l3l-decide" eyebrow="Healthy" title="The host decides first" tone="cyan">
        <DiagramFrame caption="The guided lesson's local-or-remote test.">
          <DecisionDiagram />
        </DiagramFrame>
        <p>
          Configuring <Mono>{L3.client}/{GOOD_PREFIX}</Mono> gives CLIENT a connected route for <Mono>{networkOf(L3.client, GOOD_PREFIX)}/{GOOD_PREFIX}</Mono> (mask {maskOf(GOOD_PREFIX)}); the gateway adds <Mono>0.0.0.0/0 via {L3.gw}</Mono>. For every destination the kernel picks the <b className="text-pv-text">longest matching prefix</b>: a connected match means on-link (ARP for the destination itself), only the default means “send to the gateway”.
        </p>
        <CliPanel run={l3Cli(L3G, "CLIENT", "ip route")} caption="Linux · CLIENT — the default route and the connected /24" />
        <CliPanel run={l3Cli(L3G, "CLIENT", "ip route get 10.10.20.20")} caption="Linux · CLIENT — REMOTE-SERVER: via the gateway" />
      </GuideSection>

      <GuideSection id="l3l-arp" eyebrow="Healthy" title="ARP finds the next hop" tone="violet">
        <DiagramFrame caption="The guided lesson's ARP request for the gateway.">
          <ArpDiagram />
        </DiagramFrame>
        <p>To put a packet on the wire toward the gateway, CLIENT needs the gateway&apos;s MAC. It broadcasts “who has {L3.gw}?”; only the owner of that address answers. CLIENT never ARPs for SERVER — it never needs SERVER&apos;s MAC.</p>
        <CliPanel run={l3Cli(L3G, "CLIENT", "ip neigh")} caption="Linux · CLIENT — only R1's MAC in the cache" />
        <CliPanel run={l3Cli(L3G, "R2", "show arp no-resolve")} caption="Junos · R2 — R2 resolved its own next hops: R1, SERVER, REMOTE-SERVER" />
      </GuideSection>

      <GuideSection id="l3l-frame" eyebrow="Healthy" title="Two addresses, two layers" tone="ip">
        <DiagramFrame caption="The guided lesson's echo leaving CLIENT.">
          <TwoDestinationsDiagram />
        </DiagramFrame>
        <p>The echo request leaves CLIENT in a frame addressed to <b className="text-pv-text">R1&apos;s MAC</b> (<Mono>{L3_MAC.R1_LAN.toLowerCase()}</Mono>) but carries <b className="text-pv-text">SERVER&apos;s IP</b>. At every router the Ethernet header is replaced for the next segment; the IP addresses stay end to end.</p>
      </GuideSection>

      <GuideSection id="l3l-routers" eyebrow="Healthy" title="Routers, hop by hop" tone="success">
        <DiagramFrame caption="The guided lesson's TTL at each hop.">
          <TtlDiagram />
        </DiagramFrame>
        <p>Each router looks up the destination in its own table (longest prefix), decrements TTL, resolves its own next hop with ARP and sends the packet on. traceroute exposes the path: probes with TTL 1, 2, 3… make each router answer “time exceeded” from the interface the probe arrived on.</p>
        <CliPanel run={l3Cli(L3G, "R1", "show route")} caption="Junos · R1 — Direct, Local and two Static routes via 192.0.2.1" />
        <CliPanel run={l3Cli(L3G, "CLIENT", "traceroute -n 10.10.20.20")} caption="Linux · CLIENT — R1, R2 (its transit address), REMOTE-SERVER" />
      </GuideSection>

      <GuideSection id="l3l-working" eyebrow="Evidence" title="What working looks like" tone="success">
        <FieldTable
          title="Healthy, in five questions"
          accent="success"
          columns={["Question", "Where", "Healthy answer"]}
          rows={[
            ["What does CLIENT decide?", <Mono key="1">ip route get &lt;ip&gt;</Mono>, "both servers via 10.10.10.1"],
            ["Did ARP resolve the next hop?", <Mono key="2">ip neigh</Mono>, "10.10.10.1 REACHABLE, nothing FAILED"],
            ["Does R1 have a route onward?", <Mono key="3">show route &lt;ip&gt;</Mono>, "Static via 192.0.2.1"],
            ["Does R2 deliver and route back?", <Mono key="4">show route on R2</Mono>, "Direct for both server LANs, Static back to 10.10.10.0/24"],
            ["Do both servers answer?", <Mono key="5">ping · traceroute</Mono>, "4/4, 3 hops"],
          ]}
        />
        <L3Result s={L3G} title="The lab: the healthy baseline" />
      </GuideSection>

      <GuideSection id="l3l-incident" eyebrow="Incident" title="The incident" tone="danger">
        <Callout tone="danger" title="The report" icon="!">
          {l3Ticket("mask").report}
        </Callout>
        <DiagramFrame caption="The guided lesson's scope: one reachable, one not.">
          <ScopeDiagram />
        </DiagramFrame>
        <L3Result s={L3_INC} title="The lab: reproducing it" />
        <CliPanel run={l3Cli(L3_INC, "CLIENT", "ping -c 3 10.10.20.20")} caption="Linux · CLIENT — Destination Host Unreachable, from CLIENT's own address" />
        <p>Notice who reports the failure: <b className="text-pv-text">CLIENT itself</b> (10.10.10.10), not R1. That message means “I couldn&apos;t resolve the next hop&apos;s MAC” — the packet never left CLIENT.</p>
      </GuideSection>

      <GuideSection id="l3l-decision" eyebrow="Investigation" title="What CLIENT decides now" tone="ip">
        <DiagramFrame caption="The guided lesson's longest-prefix match with /16.">
          <LpmDiagram />
        </DiagramFrame>
        <CliPanel run={l3Cli(L3_INC, "CLIENT", "ip addr")} caption="Linux · CLIENT — 10.10.10.10/16" />
        <CliPanel run={l3Cli(L3_INC, "CLIENT", "ip route")} caption="Linux · CLIENT — the connected route is now 10.10.0.0/16" />
        <CliPanel run={l3Cli(L3_INC, "CLIENT", "ip route get 10.10.20.20")} caption="Linux · CLIENT — REMOTE-SERVER is now “on-link”: no via" />
        <CliPanel run={l3Cli(L3_INC, "CLIENT", "ip route get 10.20.20.20")} caption="Linux · CLIENT — SERVER still via the gateway" />
        <p>With /{FAULT_PREFIX}, 10.10.20.20 matches the connected 10.10.0.0/16 — and /16 beats /0. 10.20.20.20 is outside 10.10.0.0/16, so only the default route matches it. That&apos;s the whole asymmetry.</p>
      </GuideSection>

      <GuideSection id="l3l-arpfail" eyebrow="Investigation" title="An ARP nobody answers" tone="warning">
        <DiagramFrame caption="The guided lesson's failed attempt.">
          <BrokenDiagram />
        </DiagramFrame>
        <CliPanel run={l3Cli(L3_INC, "CLIENT", "ip neigh")} caption="Linux · CLIENT — 10.10.20.20 FAILED: asked on the LAN, never answered" />
        <p className="text-sm text-pv-text-muted">CLIENT asks its own LAN “who has 10.10.20.20?”. REMOTE-SERVER is two routers away; nobody on the LAN owns that address, so nobody answers. No IPv4 packet for it is ever sent.</p>
      </GuideSection>

      <GuideSection id="l3l-r1" eyebrow="Investigation" title="R1's side of the story" tone="violet">
        <DiagramFrame caption="The guided lesson's view from R1.">
          <R1Diagram />
        </DiagramFrame>
        <CliPanel run={l3Only(L3_INC, "R1", "show system statistics arp", /ARP requests received|not for me|ARP replies sent/)} caption="Junos · R1 — ARP requests that were not for R1" />
        <CliPanel run={l3Cli(L3_INC, "R1", "show route 10.10.20.20")} caption="Junos · R1 — the route to 10.10.20.0/24 is there" />
        <ChecklistCard tone="violet" title="R1 is innocent" mark="→" items={["it heard the ARP broadcast — and correctly ignored it (10.10.20.20 isn't R1's; no proxy ARP)", "it has a route to 10.10.20.0/24", "it never received an IPv4 packet for 10.10.20.20 to forward"]} />
      </GuideSection>

      <GuideSection id="l3l-repair" eyebrow="Repair" title="Repair and proof" tone="success">
        <p>Fix the prefix length. On Linux, removing the /16 address also removes the default route (its gateway is no longer on a connected network), so it must be added back:</p>
        <CliPanel run={{ prompt: "admin@client:~$ ", command: "sudo ip addr del 10.10.10.10/16 dev eth0", output: "admin@client:~$ sudo ip addr add 10.10.10.10/24 dev eth0\nadmin@client:~$ sudo ip route add default via 10.10.10.1" }} caption="Linux · CLIENT — replace the address, restore the default route" />
        <CliPanel run={l3Cli(L3_FIX, "CLIENT", "ip route get 10.10.20.20")} caption="Linux · CLIENT — REMOTE-SERVER via the gateway again" />
        <L3Result s={L3_FIX} from={L3_INC.tests.length} title="The lab: fresh pings to both servers" />
        <DiagramFrame caption="The guided lesson's before and after.">
          <VerifyDiagram />
        </DiagramFrame>
        <ChecklistCard tone="success" title="Proved, not assumed" mark="✓" items={["CLIENT is 10.10.10.10/24 with its default route via 10.10.10.1", "ip route get shows both servers via the gateway", "fresh pings: SERVER 4/4, REMOTE-SERVER 4/4", "nothing changed on R1 or R2"]} />
      </GuideSection>

      <GuideSection id="l3l-other" eyebrow="Beyond this incident" title="Other ways it breaks" tone="warning">
        <FailureSignatures
          items={[
            { tag: "GW", title: "Wrong default gateway", tone: "warning", points: ["everything off-LAN fails", "Host Unreachable from the host itself"] },
            { tag: "RT", title: "Router without a route", tone: "danger", points: ["Net Unreachable from the router", "traceroute !N"] },
            { tag: "BACK", title: "No route back", tone: "danger", points: ["silence, no error", "traceroute stops after hop 1"] },
            { tag: "LOOP", title: "Routing loop", tone: "danger", points: ["Time to live exceeded", "R1, R2, R1, R2…"] },
          ]}
        />
        <CliPanel run={l3Only(T.noroute, "CLIENT", "ping -c 2 10.20.20.20", /From|statistics|transmitted/)} caption="Linux · CLIENT — R1 has no route: Destination Net Unreachable from 10.10.10.1" />
        <CliPanel run={l3Cli(T.return, "CLIENT", "traceroute -n 10.20.20.20")} caption="Linux · CLIENT — no route back on R2: silence after hop 1" />
        <CliPanel run={l3Only(T.loop, "CLIENT", "traceroute -n 10.10.20.20", /traceroute| [1-6] /)} caption="Linux · CLIENT — a loop between R1 and R2" />
        <p className="text-sm text-pv-text-muted">Each is a ticket in the Layer 3 Lab, together with this incident.</p>
      </GuideSection>

      <GuideSection id="l3l-model" eyebrow="Mental model" title="Mental model" tone="cyan">
        <p>
          Think of posting a letter from an office. First you decide: is the recipient in this building (hand it over yourself) or elsewhere (drop it at the mail room)? The prefix length is your idea of how big “this building” is. Then you need the right person&apos;s desk — you ask around the floor (ARP), but only for the mail room or the in-building colleague, never for someone in another city. The mail room (router) reads the city on the envelope, stamps it (TTL) and sends it on; if a city is unknown it returns the letter with a note. If you think the building is much bigger than it is, you&apos;ll walk the corridors asking for someone who works across town — and the mail room never even sees your letter.
        </p>
        <Callout tone="cyan" title="When it breaks, ask in this order" icon="→">
          What does the sending host decide for this destination? Did ARP for the next hop succeed? Does each router have a route onward — and back? Who sent the error message, if any? Then fix one thing and ping again, in both directions.
        </Callout>
      </GuideSection>

      <GuideSection id="l3l-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Prefix length", def: "How many leading bits of the address are the network (/24 = 255.255.255.0)." },
            { term: "Connected route", def: "The route a host or router creates for the network of its own address." },
            { term: "Default route", def: "0.0.0.0/0 — the route used when nothing more specific matches." },
            { term: "Longest-prefix match", def: "Among all matching routes, the most specific wins." },
            { term: "Next hop", def: "The neighbour a packet is handed to: the destination (on-link) or a router." },
            { term: "TTL", def: "Hop limit decremented by every router; at zero the packet is dropped with time exceeded." },
            { term: "Destination Host Unreachable", def: "On Linux, printed when ARP for the next hop failed — often from the sender itself." },
            { term: "Return path", def: "The route the reply needs back to the source; it can fail independently." },
          ]}
        />
      </GuideSection>

      <GuideSection id="l3l-recap" eyebrow="Reference" title="Recap" tone="success">
        <ChecklistCard tone="success" title="You can now" mark="✓" items={["predict a host's routing decision", "say whose MAC is ARPed for", "read routing tables and traceroute", "tell the sender's errors from a router's and from silence", "find mask, gateway, route, return-path and loop faults", "prove a repair in both directions"]} />
      </GuideSection>

      <GuideSection id="l3l-practice" eyebrow="Next" title="Practice it" tone="violet">
        <p>The Deep Dive tab covers Layer 3 in full: connected and default routes, local versus remote, ARP, Layer 2 versus Layer 3 addresses, longest-prefix match, mask mistakes, route sources, TTL and traceroute, ICMP errors, asymmetric paths, and every failure signature with real evidence. The lab lets you break and repair it yourself.</p>
        <LessonLabBridge />
        <PresentationBridge>Rewatch the Layer 3 presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
