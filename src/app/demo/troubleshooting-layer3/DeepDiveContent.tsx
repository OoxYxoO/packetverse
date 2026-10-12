import { CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DNode, FailureSignatures, FieldTable, FlowSteps, Glossary, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { LadderDiagram, SeqLanes } from "@/components/lesson/TroubleshootingGuideSvg";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, FailureWalk } from "@/components/lesson/GuideCli";
import { L3 } from "@/lib/sim-engine/scenarios/troubleshootingLayer3";
import { l3Apply, l3Healthy, type L3Action, type L3State } from "@/lib/sim-engine/scenarios/l3tsNet";
import { L3G, L3Result, L3_FIX, L3_INC, l3Cli, l3Only, l3TicketRun, pR, pS } from "./LessonGuideContent";

const G2 = { foundation: "Foundation", forwarding: "Forwarding", errors: "Errors and paths", trouble: "Troubleshooting", master: "Master it" };
export const L3_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "l3d-why", label: "Why start at the sender", group: G2.foundation },
  { id: "l3d-connected", label: "Connected and default routes", group: G2.foundation },
  { id: "l3d-local", label: "Local or remote", group: G2.foundation },
  { id: "l3d-arp", label: "ARP", group: G2.foundation },
  { id: "l3d-l2l3", label: "Layer 2 vs Layer 3 addresses", group: G2.forwarding },
  { id: "l3d-lpm", label: "Longest-prefix match", group: G2.forwarding },
  { id: "l3d-mask", label: "Mask mistakes", group: G2.forwarding },
  { id: "l3d-routes", label: "Where routes come from", group: G2.forwarding },
  { id: "l3d-ttl", label: "TTL and traceroute", group: G2.errors },
  { id: "l3d-icmp", label: "ICMP errors: who says what", group: G2.errors },
  { id: "l3d-asym", label: "Return paths and asymmetry", group: G2.errors },
  { id: "l3d-loops", label: "Routing loops", group: G2.errors },
  { id: "l3d-signatures", label: "Failure signatures", group: G2.trouble },
  { id: "l3d-ladder", label: "The troubleshooting ladder", group: G2.trouble },
  { id: "l3d-tickets", label: "Five faults, evidence to proof", group: G2.trouble },
  { id: "l3d-myths", label: "Common misconceptions", group: G2.master },
  { id: "l3d-quiz", label: "Knowledge check", group: G2.master },
  { id: "l3d-explain", label: "Can you explain it?", group: G2.master },
  { id: "l3d-glossary", label: "Glossary", group: G2.master },
  { id: "l3d-mental", label: "Mental model", group: G2.master },
  { id: "l3d-practice", label: "Practice in the lab", group: G2.master },
];

function ConnectedDiagram() {
  return (
    <DiagramSvg h={140} label="Configuring an address with a prefix creates a connected route; configuring a gateway creates a default route">
      <DNode x={120} y={50} label="eth0 config" sub="10.10.10.10/24 · gw 10.10.10.1" accent={D.cyan} w={200} h={50} />
      <DArrow x1={222} y1={40} x2={380} y2={30} color={D.success} />
      <DArrow x1={222} y1={60} x2={380} y2={80} color={D.violet} />
      <text x={510} y={34} textAnchor="middle" fill={D.success} fontSize={10} fontFamily="monospace">
        10.10.10.0/24 connected eth0
      </text>
      <text x={510} y={84} textAnchor="middle" fill={D.violet} fontSize={10} fontFamily="monospace">
        0.0.0.0/0 via 10.10.10.1
      </text>
      <text x={320} y={124} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        The prefix length is not a detail: it becomes a route.
      </text>
    </DiagramSvg>
  );
}

function LocalRemoteDiagram() {
  return (
    <DiagramSvg h={170} label="Local vs remote examples for a /24 host at 10.10.10.10">
      <DTable
        x={60}
        y={8}
        title="Host 10.10.10.10/24 — where does each destination go?"
        cols={[
          { label: "DESTINATION", w: 160 },
          { label: "MATCHING ROUTE", w: 210 },
          { label: "ARP FOR", w: 150 },
        ]}
        rows={[
          ["10.10.10.50", "10.10.10.0/24 connected", "10.10.10.50"],
          ["10.10.20.20", "0.0.0.0/0", "10.10.10.1 (gateway)"],
          ["10.20.20.20", "0.0.0.0/0", "10.10.10.1 (gateway)"],
          ["10.10.10.255", "connected (broadcast)", "none — FF:FF:FF:FF:FF:FF"],
        ]}
      />
    </DiagramSvg>
  );
}

function ArpDiagram() {
  return (
    <DiagramSvg h={150} label="ARP exchange: broadcast request with an all-zero target hardware address, unicast reply, cached entry with a timeout">
      <SeqLanes
        lanes={[
          { x: 150, label: "Host", color: D.cyan },
          { x: 490, label: "Next hop", color: D.violet },
        ]}
        msgs={[
          { from: 0, to: 1, label: "who-has 10.10.10.1? · dst FF:…:FF · THA 00:…:00", color: D.warning },
          { from: 1, to: 0, label: "10.10.10.1 is-at 00:00:5E:00:53:01 · unicast", color: D.success },
          { from: 0, to: 1, label: "IPv4 frames to that MAC (cached for minutes)" },
        ]}
      />
    </DiagramSvg>
  );
}

function L2L3Diagram() {
  return (
    <DiagramSvg h={160} label="Per hop the Ethernet addresses change while the IP addresses stay end to end">
      <DTable
        x={30}
        y={8}
        title="One echo, three links"
        cols={[
          { label: "LINK", w: 130 },
          { label: "ETHERNET SRC → DST", w: 250 },
          { label: "IPv4 SRC → DST · TTL", w: 200 },
        ]}
        rows={[
          ["CLIENT → R1", "CLIENT → R1 ge-0/0/0", "10.10.10.10 → 10.10.20.20 · 64"],
          ["R1 → R2", "R1 ge-0/0/1 → R2 ge-0/0/0", "10.10.10.10 → 10.10.20.20 · 63"],
          ["R2 → server", "R2 ge-0/0/2 → REMOTE-SERVER", "10.10.10.10 → 10.10.20.20 · 62"],
        ]}
      />
    </DiagramSvg>
  );
}

function LpmDiagram() {
  return (
    <DiagramSvg h={170} label="Longest-prefix match: for 10.10.20.20 a router with /8, /16, /24 and default routes chooses the /24">
      <DTable
        x={60}
        y={8}
        title="A router's table — destination 10.10.20.20"
        cols={[
          { label: "ROUTE", w: 200 },
          { label: "MATCHES?", w: 110 },
          { label: "", w: 210 },
        ]}
        rows={[
          ["0.0.0.0/0", "yes", "least specific"],
          ["10.0.0.0/8", "yes", ""],
          ["10.10.0.0/16", "yes", ""],
          ["10.10.20.0/24", "yes", "← longest: chosen"],
          ["10.10.30.0/24", "no", ""],
        ]}
        highlight={{ row: 3, color: D.success }}
      />
    </DiagramSvg>
  );
}

function MaskErrorsDiagram() {
  return (
    <DiagramSvg h={170} label="Mask too short: remote hosts look local, direct ARP fails. Mask too long: local hosts look remote and go via the gateway">
      <DTable
        x={20}
        y={8}
        title="Mask errors and their fingerprints"
        cols={[
          { label: "ERROR", w: 150 },
          { label: "EFFECT", w: 250 },
          { label: "FINGERPRINT", w: 200 },
        ]}
        rows={[
          ["Too short (/16 for /24)", "some remote hosts look on-link", "ARP for a remote address"],
          ["Too long (/28 for /24)", "some local hosts look remote", "local peers sent via gateway"],
          ["Wrong gateway", "off-link traffic goes nowhere", "ARP for the gateway fails"],
          ["Right mask, wrong address", "duplicates or wrong subnet", "gratuitous-ARP conflicts"],
        ]}
      />
    </DiagramSvg>
  );
}

function RoutesDiagram() {
  return (
    <DiagramSvg h={150} label="Route sources: connected, static and dynamic routing protocols; the most specific route wins, administrative distance breaks ties between sources">
      <DNode x={110} y={45} label="connected" sub="from interfaces" accent={D.success} w={140} />
      <DNode x={320} y={45} label="static" sub="configured by hand" accent={D.cyan} w={140} />
      <DNode x={530} y={45} label="dynamic" sub="OSPF, IS-IS, BGP…" accent={D.violet} w={140} />
      <DArrow x1={110} y1={68} x2={290} y2={112} color={D.muted} width={1.3} />
      <DArrow x1={320} y1={68} x2={320} y2={108} color={D.muted} width={1.3} />
      <DArrow x1={530} y1={68} x2={350} y2={112} color={D.muted} width={1.3} />
      <text x={320} y={130} textAnchor="middle" fill={D.text} fontSize={10} fontWeight={700}>
        RIB → FIB: longest prefix first; administrative distance only between equal prefixes
      </text>
    </DiagramSvg>
  );
}

function TtlDiagram() {
  return (
    <DiagramSvg h={130} label="TTL decreases by one at each router; if it reaches zero the router discards the packet and returns ICMP Time Exceeded, which traceroute uses">
      {[64, 63, 62, 1, 0].map((t, i) => {
        const x = 70 + i * 125;
        const last = t === 0;
        return (
          <g key={t}>
            <DNode x={x} y={50} label={last ? "router" : i === 0 ? "sender" : "router"} sub={`TTL ${t}${last ? " → drop" : ""}`} accent={last ? D.danger : D.violet} w={110} />
            {i < 4 && <DArrow x1={x + 57} y1={50} x2={x + 68} y2={50} color={D.muted} width={1.2} />}
          </g>
        );
      })}
      <text x={320} y={110} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        TTL 0 → ICMP Time Exceeded (type 11) back to the source — the basis of traceroute and of loop protection.
      </text>
    </DiagramSvg>
  );
}

function IcmpDiagram() {
  return (
    <DiagramSvg h={170} label="ICMP destination unreachable codes and who generates them">
      <DTable
        x={20}
        y={8}
        title="Who says 'unreachable', and what it means"
        cols={[
          { label: "MESSAGE", w: 230 },
          { label: "SENT BY", w: 150 },
          { label: "MEANS", w: 220 },
        ]}
        rows={[
          ["Host unreachable (local)", "the sender's own stack", "ARP for the next hop failed"],
          ["Type 3 code 0/1 net/host unreachable", "a router", "no route / next hop failed there"],
          ["Type 3 code 3 port unreachable", "the destination host", "UDP port closed"],
          ["Type 3 code 13 admin prohibited", "a filter", "blocked by policy"],
        ]}
        highlight={{ row: 0, color: D.warning }}
      />
    </DiagramSvg>
  );
}

function AsymDiagram() {
  return (
    <DiagramSvg h={150} label="Asymmetric path: the request goes through R1 and R2 while the reply returns through a different router; troubleshoot both directions">
      <DNode x={80} y={75} label="A" accent={D.cyan} w={60} />
      <DNode x={320} y={30} label="R1" accent={D.violet} w={70} />
      <DNode x={320} y={120} label="R3" accent={D.violet} w={70} />
      <DNode x={560} y={75} label="B" accent={D.success} w={60} />
      <DArrow x1={112} y1={65} x2={283} y2={35} color={D.cyan} label="request" />
      <DArrow x1={357} y1={35} x2={528} y2={65} color={D.cyan} />
      <DArrow x1={528} y1={85} x2={357} y2={115} color={D.warning} label="reply" labelDy={16} />
      <DArrow x1={283} y1={115} x2={112} y2={85} color={D.warning} />
    </DiagramSvg>
  );
}


const run = (s: L3State, ...a: L3Action[]) => a.reduce((acc, x) => l3Apply(acc, x), s);
const HC = l3Healthy();
const T = { gateway: l3TicketRun("gateway"), noroute: l3TicketRun("noroute"), return: l3TicketRun("return"), loop: l3TicketRun("loop") };
const F = {
  gateway: run(T.gateway, { type: "host", dev: "CLIENT", cfg: HC.hosts.CLIENT, text: "fix" }, pS, pR),
  noroute: run(T.noroute, { type: "cfg", dev: "R1", cfg: HC.rtrs.R1, text: "fix" }, pS, pR),
  return: run(T.return, { type: "cfg", dev: "R2", cfg: HC.rtrs.R2, text: "fix" }, pS, pR),
  loop: run(T.loop, { type: "cfg", dev: "R2", cfg: HC.rtrs.R2, text: "fix" }, pS, pR),
};

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the Layer 3 Lab" onPractice={openLab}>
      CLIENT&apos;s routing decision, every ARP cache, both routers&apos; tables, ping and traceroute walked hop by hop, Junos and Linux consoles — your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  { id: "q-decide", prompt: "A host 10.10.10.10/24 sends to 10.10.20.20. What does it do first?", options: [{ id: "a", label: "Finds only the default route matches, so it ARPs for its gateway" }, { id: "b", label: "ARPs for 10.10.20.20" }, { id: "c", label: "Asks the router whether 10.10.20.20 is local" }], correctId: "a", explanation: "10.10.20.20 is outside 10.10.10.0/24." },
  { id: "q-mac", prompt: "An echo to a remote server leaves the host. Its destination MAC belongs to…", options: [{ id: "a", label: "The gateway" }, { id: "b", label: "The remote server" }, { id: "c", label: "The switch" }], correctId: "a", explanation: "Layer 2 delivers to the next hop only." },
  { id: "q-lpm", prompt: "A table has 10.0.0.0/8, 10.10.0.0/16, 10.10.20.0/24 and 0.0.0.0/0. Which wins for 10.10.20.20?", options: [{ id: "a", label: "10.10.20.0/24" }, { id: "b", label: "10.0.0.0/8" }, { id: "c", label: "0.0.0.0/0" }], correctId: "a", explanation: "The most specific matching prefix." },
  { id: "q-hostunreach", prompt: "Linux prints “From 10.10.10.10 … Destination Host Unreachable” (10.10.10.10 is the sender). Meaning?", options: [{ id: "a", label: "ARP for the next hop failed — the packet never left" }, { id: "b", label: "The remote server rejected it" }, { id: "c", label: "A router has no route" }], correctId: "a", explanation: "The sender generates it locally when resolution fails." },
  { id: "q-silent", prompt: "Pings time out silently; traceroute shows hop 1, then * * *. Most likely?", options: [{ id: "a", label: "A router further on has no route back to the source" }, { id: "b", label: "The first router has no route" }, { id: "c", label: "The host's mask is wrong" }], correctId: "a", explanation: "A missing route onward would produce net unreachable; a missing route back produces silence." },
  { id: "q-loop", prompt: "traceroute alternates R1, R2, R1, R2 and ping reports Time to live exceeded. Cause?", options: [{ id: "a", label: "A routing loop: each router points the prefix at the other" }, { id: "b", label: "A duplex mismatch" }, { id: "c", label: "ARP failure" }], correctId: "a", explanation: "The packet bounces until TTL runs out." },
];

export function L3DeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="l3d-why" eyebrow="Foundation" title="Why start at the sender" tone="cyan">
        <p>
          Every packet&apos;s journey starts with a decision the sender makes alone, from its own address, prefix length and routes. If that decision is wrong, no router ever sees the packet — and checking routers first wastes the most time. The sender&apos;s routing table, its ARP cache and the first error message are the cheapest evidence there is.
        </p>
        <CompareCards
          items={[
            { title: "Host", tone: "cyan", tag: "decides", points: ["ip route · ip route get", "ip neigh"] },
            { title: "Routers", tone: "violet", tag: "forward", points: ["show route <ip>", "both directions"] },
            { title: "Messages", tone: "success", tag: "tell", points: ["who sent the error", "or silence"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="l3d-connected" eyebrow="Foundation" title="Connected and default routes" tone="cyan">
        <DiagramFrame caption="An address with a prefix creates a connected route; a gateway creates the default route.">
          <ConnectedDiagram />
        </DiagramFrame>
        <CliPanel run={l3Cli(L3G, "CLIENT", "ip route")} caption="Linux · CLIENT — default via 10.10.10.1 and the connected 10.10.10.0/24" />
        <p className="text-sm text-pv-text-muted">The default route can only exist while its gateway is on a connected network: remove the address and the kernel removes the route too.</p>
      </GuideSection>

      <GuideSection id="l3d-local" eyebrow="Foundation" title="Local or remote" tone="violet">
        <DiagramFrame caption="Local versus remote for a /24 host.">
          <LocalRemoteDiagram />
        </DiagramFrame>
        <CliPanel run={l3Cli(L3G, "CLIENT", "ip route get 10.10.10.1")} caption="Linux · CLIENT — the gateway: on-link, no via" />
        <CliPanel run={l3Cli(L3G, "CLIENT", "ip route get 10.20.20.20")} caption="Linux · CLIENT — SERVER: via the gateway" />
      </GuideSection>

      <GuideSection id="l3d-arp" eyebrow="Foundation" title="ARP" tone="violet">
        <DiagramFrame caption="Broadcast request, unicast reply, cached entry.">
          <ArpDiagram />
        </DiagramFrame>
        <p>ARP is local to one segment. A host answers only for its own addresses; a router answers only for its interface addresses on that segment (unless proxy ARP is enabled, which hides mistakes and is off here). Entries that never get an answer show as FAILED.</p>
        <CliPanel run={l3Cli(L3_INC, "CLIENT", "ip neigh")} caption="Linux · CLIENT during the incident — the gateway resolved, 10.10.20.20 FAILED" />
      </GuideSection>

      <GuideSection id="l3d-l2l3" eyebrow="Forwarding" title="Layer 2 vs Layer 3 addresses" tone="ip">
        <DiagramFrame caption="Ethernet addresses change per hop; IP addresses stay end to end.">
          <L2L3Diagram />
        </DiagramFrame>
        <CliPanel run={l3Cli(L3G, "R1", "show arp no-resolve")} caption="Junos · R1 — CLIENT on ge-0/0/0, R2 on ge-0/0/1: one next hop per segment" />
      </GuideSection>

      <GuideSection id="l3d-lpm" eyebrow="Forwarding" title="Longest-prefix match" tone="ip">
        <DiagramFrame caption="The most specific matching route wins.">
          <LpmDiagram />
        </DiagramFrame>
        <CliPanel run={l3Only(L3G, "R2", "show route", /\/|inet\.0/)} caption="Junos · R2 — 0.0.0.0/0 to R1, but 10.10.20.0/24 is Direct and wins for REMOTE-SERVER" />
      </GuideSection>

      <GuideSection id="l3d-mask" eyebrow="Forwarding" title="Mask mistakes" tone="danger">
        <DiagramFrame caption="Too short and remote looks local; too long and local looks remote.">
          <MaskErrorsDiagram />
        </DiagramFrame>
        <FieldTable
          title="CLIENT 10.10.10.10 with different prefix lengths"
          accent="danger"
          columns={["Prefix", "10.10.10.1 (gateway)", "10.10.20.20", "10.20.20.20"]}
          rows={[
            ["/24 (correct)", "on-link", "via gateway", "via gateway"],
            ["/16 (too short)", "on-link", ["on-link ✗"].join(""), "via gateway"],
            ["/28 (too long)", "on-link (10.10.10.0/28)", "via gateway", "via gateway"],
          ]}
        />
        <p className="text-sm text-pv-text-muted">A too-long prefix hurts only neighbours outside the smaller network — they become “remote” and go via the gateway (often still working, just less directly). A too-short prefix breaks remote hosts inside the bigger network, which is exactly this lesson&apos;s incident.</p>
      </GuideSection>

      <GuideSection id="l3d-routes" eyebrow="Forwarding" title="Where routes come from" tone="violet">
        <DiagramFrame caption="Route sources and preferences.">
          <RoutesDiagram />
        </DiagramFrame>
        <FieldTable
          title="Junos route preferences (lower wins for the same prefix)"
          accent="violet"
          columns={["Source", "Preference", "In this lab"]}
          rows={[
            ["Direct / Local", "0", "interface networks and addresses"],
            ["Static", "5", "R1 → 10.10.20.0/24, 10.20.20.0/24; R2 → 10.10.10.0/24 and 0.0.0.0/0"],
            ["OSPF internal", "10", "—"],
            ["BGP", "170", "—"],
          ]}
        />
        <p className="text-sm text-pv-text-muted">Preference only breaks ties between sources for the <i>same</i> prefix; a more specific prefix always beats a less specific one, whatever its source.</p>
      </GuideSection>

      <GuideSection id="l3d-ttl" eyebrow="Errors and paths" title="TTL and traceroute" tone="success">
        <DiagramFrame caption="TTL counts routers; traceroute uses the time-exceeded replies.">
          <TtlDiagram />
        </DiagramFrame>
        <CliPanel run={l3Only(L3G, "CLIENT", "ping -c 1 10.10.20.20", /ttl=/)} caption="Linux · CLIENT — reply TTL 62: REMOTE-SERVER's 64 minus two routers" />
        <CliPanel run={l3Cli(L3G, "R1", "traceroute 10.10.20.20 no-resolve")} caption="Junos · R1 — from R1 the path is one router shorter" />
      </GuideSection>

      <GuideSection id="l3d-icmp" eyebrow="Errors and paths" title="ICMP errors: who says what" tone="danger">
        <DiagramFrame caption="ICMP destination unreachable codes and their sources.">
          <IcmpDiagram />
        </DiagramFrame>
        <FieldTable
          title="Reading the message"
          accent="danger"
          columns={["Message (Linux ping)", "Sent by", "Means"]}
          rows={[
            ["Destination Host Unreachable (from your own address)", "the sender", "ARP for the next hop failed"],
            ["Destination Host Unreachable (from a router)", "the last router", "it couldn't resolve the destination on its LAN"],
            ["Destination Net Unreachable", "a router", "no route to the destination"],
            ["Time to live exceeded", "a router", "TTL ran out — a loop, or too many hops"],
            ["(no message, no reply)", "nobody", "lost on the way — often the return path"],
          ]}
        />
        <CliPanel run={l3Only(T.noroute, "CLIENT", "ping -c 2 10.20.20.20", /From|transmitted/)} caption="Linux · CLIENT — R1 reports “no route”" />
      </GuideSection>

      <GuideSection id="l3d-asym" eyebrow="Errors and paths" title="Return paths and asymmetry" tone="warning">
        <DiagramFrame caption="Request and reply can take different paths — and fail differently.">
          <AsymDiagram />
        </DiagramFrame>
        <p>A ping needs two working paths: there and back. When the reply direction lacks a route, the requests arrive, the destination answers, and the answer dies — silently, because the router that can&apos;t route back also can&apos;t report an error to the source. Always check the route back.</p>
        <CliPanel run={l3Cli(T.return, "R2", "show route 10.10.10.10")} caption="Junos · R2 — no route back to CLIENT" />
      </GuideSection>

      <GuideSection id="l3d-loops" eyebrow="Errors and paths" title="Routing loops" tone="danger">
        <p>If R1 sends a prefix to R2 and R2 sends it back to R1 — here because R2 lost its connected route to 10.10.20.0/24 and fell back to its default — the packet bounces until TTL runs out. The router where it hits zero reports Time to live exceeded.</p>
        <CliPanel run={l3Only(T.loop, "CLIENT", "ping -c 2 10.10.20.20", /From|transmitted/)} caption="Linux · CLIENT — Time to live exceeded from R2's transit address" />
        <CliPanel run={l3Cli(T.loop, "R2", "show route 10.10.20.20")} caption="Junos · R2 — only the default route matches" />
      </GuideSection>

      <GuideSection id="l3d-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "MASK", title: "Prefix too short", tone: "danger", points: ["some remote hosts fail, others work", "Host Unreachable from the sender; ARP FAILED"] },
            { tag: "GW", title: "Wrong gateway", tone: "warning", points: ["everything off-LAN fails", "ARP FAILED for the gateway"] },
            { tag: "RT", title: "No route onward", tone: "danger", points: ["Net Unreachable from a router", "!N in traceroute"] },
            { tag: "BACK", title: "No route back", tone: "danger", points: ["silence", "traceroute stars after the last good hop"] },
            { tag: "LOOP", title: "Routing loop", tone: "danger", points: ["TTL exceeded", "alternating hops"] },
            { tag: "DEF", title: "No default route", tone: "violet", points: ["“Network is unreachable” at once", "nothing leaves the host"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="l3d-ladder" eyebrow="Troubleshooting" title="The troubleshooting ladder" tone="danger">
        <DiagramFrame caption="Start at the sender's own decision.">
          <DiagramSvg h={170} label="Layer 3 ladder">
            <LadderDiagram
              rows={[
                { rung: "Link / Ethernet", evidence: "up? frames forwarded?", status: "ok" },
                { rung: "ARP / neighbor", evidence: "next hop resolved? which next hop?", status: "suspect" },
                { rung: "Host addressing", evidence: "address, prefix, gateway vs plan", status: "suspect" },
                { rung: "Host route choice", evidence: "ip route get <dst>", status: "ok" },
                { rung: "Router forwarding", evidence: "LPM, next hop, TTL, both directions", status: "ok" },
                { rung: "Destination", evidence: "answers from its own segment?", status: "ok" },
              ]}
            />
          </DiagramSvg>
        </DiagramFrame>
        <TroubleshootingFlow
          steps={[
            { question: "Which destinations fail, and how?", look: "ping several; note who sends the error" },
            { question: "What does the sender decide?", look: "ip addr · ip route · ip route get <dst>" },
            { question: "Did ARP for the next hop succeed?", look: "ip neigh — FAILED entries" },
            { question: "Does every router have a route onward?", look: "show route <dst>" },
            { question: "…and back?", look: "show route <source> on the far routers" },
          ]}
        />
        <FlowSteps
          steps={[
            { title: "Scope", body: "Which destinations fail, which work?", tone: "cyan" },
            { title: "Sender first", body: "Its table, its ARP, its choice of next hop.", tone: "violet" },
            { title: "Follow the packet", body: "Hop by hop, both directions.", tone: "warning" },
            { title: "Fix where it breaks", body: "Then fresh pings to every affected destination.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="l3d-tickets" eyebrow="Troubleshooting" title="Five faults, evidence to proof" tone="danger">
        <FailureWalk title="1 · REMOTE-SERVER unreachable, SERVER fine" normal="CLIENT 10.10.10.10/24." change="Re-installed as 10.10.10.10/16." evidence={<CliPanel run={l3Cli(L3_INC, "CLIENT", "ip route get 10.10.20.20")} caption="Linux · CLIENT — on-link: no via" />} next="CLIENT ARPs for 10.10.20.20 on the LAN; FAILED; R1 counts it as not for me." fix={<Mono>CLIENT: ip addr del 10.10.10.10/16 · ip addr add 10.10.10.10/24 · ip route add default via 10.10.10.1</Mono>} proof={<L3Result s={L3_FIX} from={L3_INC.tests.length} title="Fresh pings to both servers" />} />
        <FailureWalk title="2 · CLIENT can't reach anything beyond its LAN" normal="Default route via 10.10.10.1." change="The gateway was changed to 10.10.10.254." evidence={<CliPanel run={l3Cli(T.gateway, "CLIENT", "ip neigh")} caption="Linux · CLIENT — 10.10.10.254 FAILED" />} next="Every off-LAN destination is sent to a next hop nobody owns." fix={<Mono>CLIENT: sudo ip route replace default via 10.10.10.1</Mono>} proof={<L3Result s={F.gateway} from={T.gateway.tests.length} title="Fresh pings to both servers" />} />
        <FailureWalk title="3 · SERVER unreachable — and the router says so" normal="R1 routes 10.20.20.0/24 via 192.0.2.1." change="That static route was deleted." evidence={<CliPanel run={l3Only(T.noroute, "CLIENT", "traceroute -n 10.20.20.20", /!N/)} caption="Linux · CLIENT — !N from R1" />} next="R1 receives the packet, has no match, answers net unreachable." fix={<Mono>R1: set routing-options static route 10.20.20.0/24 next-hop 192.0.2.1 → commit</Mono>} proof={<L3Result s={F.noroute} from={T.noroute.tests.length} title="Fresh pings to both servers" />} />
        <FailureWalk title="4 · Pings vanish without an error" normal="R2 routes 10.10.10.0/24 back via 192.0.2.0 (plus a default)." change="Both routes were removed." evidence={<CliPanel run={l3Only(T.return, "CLIENT", "traceroute -n 10.20.20.20", /traceroute| [1-3] /)} caption="Linux · CLIENT — hop 1, then nothing" />} next="Requests reach SERVER; the replies die at R2, which can't even report back." fix={<Mono>R2: set routing-options static route 10.10.10.0/24 next-hop 192.0.2.0 · static route 0.0.0.0/0 next-hop 192.0.2.0 → commit</Mono>} proof={<L3Result s={F.return} from={T.return.tests.length} title="Fresh pings to both servers" />} />
        <FailureWalk title="5 · “Time to live exceeded” for REMOTE-SERVER" normal="R2 ge-0/0/2 up, 10.10.20.0/24 Direct." change="ge-0/0/2 was disabled during re-cabling." evidence={<CliPanel run={l3Only(T.loop, "R2", "show interfaces terse", /Interface|ge-0\/0\/2 /)} caption="Junos · R2 — ge-0/0/2 down" />} next="R2 falls back to its default (to R1); R1 sends it back to R2 — a loop." fix={<Mono>R2: delete interfaces ge-0/0/2 disable → commit</Mono>} proof={<L3Result s={F.loop} from={T.loop.tests.length} title="Fresh pings to both servers" />} />
      </GuideSection>

      <GuideSection id="l3d-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "If one server behind a router works, the router is fine for all of them.", correction: "Often true — but the sender may never have sent the packet. Check its decision first." },
            { myth: "A host ARPs for the remote server.", correction: "It ARPs only for its next hop: the destination if on-link, otherwise the gateway." },
            { myth: "Destination Host Unreachable always comes from a router.", correction: "Linux prints it from your own address when your own ARP failed." },
            { myth: "If the request arrives, the problem is at the destination.", correction: "The reply needs its own route back." },
            { myth: "A wrong mask breaks everything.", correction: "It breaks exactly the destinations whose on-link decision flips." },
          ]}
        />
      </GuideSection>

      <GuideSection id="l3d-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="l3d-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "Why did SERVER keep working with the /16?", a: `${L3.server} is outside 10.10.0.0/16, so only the default route matched it — it still went via the gateway.` },
            { q: "Why didn't R1 answer CLIENT's ARP for 10.10.20.20?", a: "It isn't R1's address and proxy ARP is off; R1 only counted it as a request not for itself." },
            { q: "Why did the default route disappear when the address was removed?", a: "Its gateway was no longer on any connected network, so the kernel removed the route." },
            { q: "How do you tell a missing route onward from a missing route back?", a: "Onward: a router answers net unreachable (!N). Back: silence, traceroute stops after the last router that can still reach you." },
            { q: "Why does a loop end in Time to live exceeded?", a: "Each bounce costs one TTL; at zero the router drops the packet and reports it." },
          ]}
        />
      </GuideSection>

      <GuideSection id="l3d-glossary" eyebrow="Master it" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "RIB / FIB", def: "Routing Information Base (all routes) / Forwarding Information Base (the chosen ones)." },
            { term: "Route preference", def: "Junos's preference between route sources for the same prefix (administrative distance elsewhere)." },
            { term: "Proxy ARP", def: "A router answering ARP for addresses behind it — off here; it would mask mask errors." },
            { term: "/31", def: "A point-to-point link with two addresses and no broadcast (RFC 3021)." },
            { term: "ip route get", def: "Linux: shows exactly which route, next hop and source address a destination would use." },
            { term: "Asymmetric routing", def: "Request and reply taking different paths." },
            { term: "FAILED (neighbour)", def: "An ARP resolution that got no answer." },
            { term: "!N", def: "traceroute's mark for an ICMP network-unreachable reply." },
          ]}
        />
      </GuideSection>

      <GuideSection id="l3d-mental" eyebrow="Master it" title="Mental model" tone="violet">
        <p>Posting a letter from an office: decide in-building or mail room (prefix length), find the right desk on your floor only (ARP), let the mail room read the city and stamp it (routing, TTL) — and remember the reply needs a mail room that knows your address too.</p>
      </GuideSection>

      <GuideSection id="l3d-practice" eyebrow="Master it" title="Practice in the lab" tone="violet">
        <p>Six Learn levels, then the workspace: CLIENT&apos;s routing decision, ARP caches, both routers&apos; tables, ping and traceroute hop by hop, Junos and Linux consoles, five challenges and the five tickets above.</p>
        <LabBridge />
        <PresentationBridge>Rewatch the Layer 3 presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
