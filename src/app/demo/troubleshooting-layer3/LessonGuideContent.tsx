import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { LadderDiagram, SeqLanes, WorkflowDiagram } from "@/components/lesson/TroubleshootingGuideSvg";
import { FAULT_PREFIX, GOOD_PREFIX, L3, L3_MAC, maskOf, networkOf } from "@/lib/sim-engine/scenarios/troubleshootingLayer3";

export const L3_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "l3l-mission", label: "The mission" },
  { id: "l3l-method", label: "The method" },
  { id: "l3l-topology", label: "Topology" },
  { id: "l3l-decision", label: "Local or remote?" },
  { id: "l3l-arp", label: "ARP for the next hop" },
  { id: "l3l-two-dst", label: "Gateway MAC, remote IP" },
  { id: "l3l-ttl", label: "TTL along the path" },
  { id: "l3l-scope", label: "Scoping the symptom" },
  { id: "l3l-lpm", label: "Which route wins" },
  { id: "l3l-broken", label: "The broken attempt" },
  { id: "l3l-r1", label: "R1 sees nothing" },
  { id: "l3l-ladder", label: "Evidence ladder" },
  { id: "l3l-verify", label: "Repair & verify" },
  { id: "l3l-glossary", label: "Glossary" },
];

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

export function L3LessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="l3l-mission" eyebrow="Mission" title="Every IPv4 packet starts with a host's decision" tone="cyan">
        <p>Before a single frame leaves, a host decides whether the destination is on its own segment or behind a router. That decision — driven by the prefix length — chooses who it ARPs for and where the frame goes. This lesson follows the decision, then troubleshoots a host that gets it wrong.</p>
      </GuideSection>

      <GuideSection id="l3l-method" eyebrow="Method" title="The same workflow, at Layer 3" tone="violet">
        <DiagramFrame caption="Scope by destination before suspecting the path.">
          <DiagramSvg h={82} label="Troubleshooting workflow">
            <WorkflowDiagram notes={["which dest?", "what works?", "tables, ARP", "one cause", "far side", "one change", "the packet"]} />
          </DiagramSvg>
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l3l-topology" eyebrow="Topology" title="One client, two routers, two servers" tone="cyan">
        <DiagramFrame caption="Both servers share the path from CLIENT to R2.">
          <TopologyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l3l-decision" eyebrow="Host logic" title="Local or remote?" tone="ip">
        <DiagramFrame caption="The mask decides what the host believes is on-link.">
          <DecisionDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l3l-arp" eyebrow="ARP" title="ARP resolves the next hop" tone="warning">
        <DiagramFrame caption="Broadcast request, unicast reply.">
          <ArpDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l3l-two-dst" eyebrow="Addressing" title="Gateway MAC, remote IP" tone="ip">
        <DiagramFrame caption="Two layers, two different destinations in one frame.">
          <TwoDestinationsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l3l-ttl" eyebrow="Forwarding" title="TTL along the path" tone="violet">
        <DiagramFrame caption="Count routers by TTL.">
          <TtlDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l3l-scope" eyebrow="Incident" title="Scope before you suspect the path" tone="warning">
        <DiagramFrame caption="The shared path works — the difference is per destination.">
          <ScopeDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l3l-lpm" eyebrow="Longest match" title="Which route wins on CLIENT" tone="danger">
        <DiagramFrame caption="The default route is fine — it just never gets a chance.">
          <LpmDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Not a 'broken default route'">
          A default gateway is consulted only when no longer prefix matches. With a /16, the connected route covers 10.10.20.20, so CLIENT treats it as a neighbor.
        </Callout>
      </GuideSection>

      <GuideSection id="l3l-broken" eyebrow="Evidence" title="The broken attempt" tone="danger">
        <DiagramFrame caption="An ARP for a remote address is the fingerprint.">
          <BrokenDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l3l-r1" eyebrow="Evidence" title="R1 sees nothing to route" tone="violet">
        <DiagramFrame caption="Absence of traffic at R1 points back at the sender.">
          <R1Diagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l3l-ladder" eyebrow="Ladder" title="The lowest failing rung" tone="cyan">
        <DiagramFrame caption="Addressing failed; everything the packet would have used is healthy.">
          <DiagramSvg h={150} label="Evidence ladder for this incident">
            <LadderDiagram
              rows={[
                { rung: "Physical / Ethernet", evidence: "links up · broadcasts flooded", status: "ok" },
                { rung: "ARP / neighbor", evidence: `${L3.remote} INCOMPLETE (symptom)`, status: "suspect" },
                { rung: "IP addressing", evidence: `CLIENT /${FAULT_PREFIX} vs plan /${GOOD_PREFIX}`, status: "fail" },
                { rung: "Routing / forwarding", evidence: "R1, R2 routes correct", status: "ok" },
                { rung: "Destination", evidence: "answers R2 5/5", status: "ok" },
              ]}
            />
          </DiagramSvg>
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l3l-verify" eyebrow="Verify" title="Fix the host, prove it with the packet" tone="success">
        <DiagramFrame caption="The proof is the frame the broken host never produced.">
          <VerifyDiagram />
        </DiagramFrame>
        <ChecklistCard tone="success" title="Verified" mark="✓" items={[`CLIENT table: ${networkOf(L3.client, GOOD_PREFIX)}/${GOOD_PREFIX} connected + default via ${L3.gw}`, `ARP for ${L3.gw} (not ${L3.remote})`, `Echo: Ethernet dst R1, IPv4 dst ${L3.remote}; TTL 64 → 63 → 62`, `${L3.remote} 5/5; ${L3.server} still 5/5`]} />
        <p>
          On a Linux host, <Mono>ip route get 10.10.20.20</Mono> shows the chosen route and next hop in one line — the fastest way to see this fault.
        </p>
      </GuideSection>

      <GuideSection id="l3l-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <Glossary
          items={[
            { term: "Prefix length / mask", def: "How many leading bits of an address name its network (/24 = 255.255.255.0)." },
            { term: "Connected route", def: "A route created automatically from an interface's address and prefix length." },
            { term: "On-link", def: "Reachable directly on the local segment — resolved with ARP for the destination itself." },
            { term: "Default gateway", def: "The router used for destinations that no more specific route covers." },
            { term: "Longest-prefix match", def: "Among matching routes, the one with the longest prefix wins." },
            { term: "Proxy ARP", def: "A router answering ARP on behalf of other addresses — can mask host misconfigurations." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
