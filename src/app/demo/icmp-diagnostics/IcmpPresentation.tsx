"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, Lines, MiniTable, PacketCard, Pills, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { BIG_DATA, ECHO_IDENTIFIER, FAULT_MTU, FIXED_DATA, IC_ADDR, INITIAL_TTL, PING_DATA } from "@/lib/sim-engine/scenarios/icmpDiagnostics";

/**
 * ICMP — the presentation before the lesson, on the lesson's network (HOST-A — R1 — R2 — HOST-B) and incident
 * (a 1400-byte transit link, 1500-byte DF packets → Destination Unreachable 3/4). Presentation state only.
 */

type Id = "why" | "what" | "ping" | "reply" | "proves" | "ttl" | "expire" | "trace" | "unreach" | "mtu" | "df" | "symptom" | "trouble" | "math" | "verify" | "types" | "block" | "silence" | "recap";
type Step = DeckStep & { id: Id };
const Bb = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const BIG_TOTAL = 20 + 8 + BIG_DATA;

const STEPS: Step[] = [
  { id: "why", chapter: "Why ICMP exists", title: "IP just delivers, or silently drops.", body: <p>IP has no way of its own to tell the sender “this went wrong”. If a router can&apos;t forward a packet, the packet simply disappears, and the sender has no idea why.</p> },
  { id: "what", chapter: "Why ICMP exists", title: "ICMP is how the network talks back.", body: <p><Bb>ICMP</Bb> (Internet Control Message Protocol) carries small messages: answers to tests (“are you there?”) and error reports (“I had to drop your packet, here&apos;s why”). It rides directly inside IP (Protocol 1). No TCP, no UDP, no ports.</p> },
  { id: "ping", chapter: "Ping", title: "Ping sends an Echo Request (type 8).", body: <p>HOST-A sends Echo Request 8/0 to HOST-B with an <Bb>Identifier</Bb> ({ECHO_IDENTIFIER}) and a <Bb>Sequence</Bb> number. Each router subtracts 1 from the TTL on the way.</p> },
  { id: "reply", chapter: "Ping", title: "HOST-B answers with an Echo Reply (type 0).", body: <p>The reply copies the Identifier, Sequence and data, so HOST-A can match it to its request and measure the round-trip time. A reply proves the whole path works <i>in both directions</i>.</p> },
  { id: "proves", chapter: "Ping", title: "A reply proves the round trip — not everything.", body: <p>One small ICMP packet went there and back. That proves IP reachability <Bb>both ways</Bb> for that packet. It does not prove that an application works, that big packets fit, that there is no loss, or that DNS works.</p> },
  { id: "ttl", chapter: "TTL", title: "Every router takes one off the TTL.", body: <p>TTL starts at {INITIAL_TTL}. R1 makes it {INITIAL_TTL - 1}, R2 makes it {INITIAL_TTL - 2}. The destination host doesn&apos;t decrement. TTL exists so a packet caught in a routing loop eventually dies.</p> },
  { id: "expire", chapter: "TTL", title: "TTL would reach 0 → the router drops it and says so.", body: <p>A router that would forward with TTL ≤ 1 discards the packet and sends <Bb>Time Exceeded (11/0)</Bb> back to the source, quoting the start of the dropped packet so the sender knows which one it was.</p> },
  { id: "trace", chapter: "Traceroute", title: "Traceroute expires packets on purpose.", body: <p>Send with TTL 1: the first router answers Time Exceeded, revealing itself. TTL 2: the second router answers. Eventually the destination answers with an Echo Reply. Pick a TTL below.</p> },
  { id: "unreach", chapter: "When delivery fails", title: "Routers say why: Destination Unreachable.", body: <p>No route → <Bb>3/0</Bb>. Route, but nobody answers ARP → <Bb>3/1</Bb>. Nothing listening on a UDP port → <Bb>3/3</Bb> from the host itself. Each error names the device that sent it: the problem is at or just beyond it.</p> },
  { id: "mtu", chapter: "Packet size", title: "Each link has a maximum packet size: the MTU.", body: <p>The LANs carry 1500-byte IP packets. In this lesson the R1–R2 transit link only carries <Bb>{FAULT_MTU}</Bb>.</p> },
  { id: "df", chapter: "Packet size", title: `A ${BIG_TOTAL}-byte packet with DF set can't fit.`, body: <p>The <Bb>DF</Bb> (Don&apos;t Fragment) flag forbids splitting it. R1 must drop it, and reports <Bb>Destination Unreachable 3/4: Fragmentation Needed</Bb>, including the next-hop MTU ({FAULT_MTU}).</p> },
  { id: "symptom", chapter: "The incident", title: "Small pings work. Big ones vanish.", body: <p>Users report that some things load and others hang. A {PING_DATA}-byte ping succeeds; a {BIG_DATA}-byte ping with DF fails. That pattern points at size, not reachability.</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Let ICMP tell you what's wrong.", body: <p>The 3/4 message names the device (R1) and the limit ({FAULT_MTU}). That&apos;s the evidence that turns a guess into a root cause.</p> },
  { id: "math", chapter: "Troubleshooting", title: "Fit the packet to the path.", body: <p>Keep DF and send a packet that fits: IP header 20 + ICMP header 8 + data <Bb>{FIXED_DATA}</Bb> = {FAULT_MTU} bytes.</p> },
  { id: "verify", chapter: "Troubleshooting", title: "Prove it in both directions.", body: <p>The {FAULT_MTU}-byte DF ping crosses R1 and R2 and the Echo Reply comes back. One byte more would trigger 3/4 again: the limit is understood, not guessed.</p> },
  { id: "types", chapter: "Messages you'll meet", title: "Type and code say exactly what happened.", body: <p>Learn to read them in captures and in tool output.</p> },
  { id: "block", chapter: "A common mistake", title: "“Just block all ICMP” breaks things.", body: <p>If 3/4 messages are filtered, senders never learn the path MTU: big packets vanish with no explanation (a <Bb>PMTUD black hole</Bb>). Filter carefully; don&apos;t blanket-drop ICMP.</p> },
  { id: "silence", chapter: "Silence is evidence", title: "No answer is a clue, not a verdict.", body: <p>A firewall that drops sends nothing. A reply can be lost on the <Bb>way back</Bb> even though the request arrived. Ask where the probe was last seen, who answered, and what went silent — then look just beyond it.</p> },
  { id: "recap", chapter: "The whole idea", title: "Echo tests the path. Errors explain the drops.", body: <p>Now run ping and traceroute yourself in the lesson and fix the MTU incident.</p> },
];

const VISUAL: Record<Id, string> = { why: "net", what: "packet", ping: "net", reply: "net", proves: "proves", unreach: "unreach", silence: "silence", ttl: "net", expire: "net", trace: "net", mtu: "net", df: "net", symptom: "net", trouble: "trouble", math: "math", verify: "net", types: "types", block: "net", recap: "recap" };

const NODES: TopoNode[] = [
  { id: "a", label: "HOST-A", sub: IC_ADDR["HOST-A"], icon: "💻", x: 9, y: 58 },
  { id: "r1", label: "R1", sub: IC_ADDR["R1:LAN"], icon: "R", x: 36, y: 58 },
  { id: "r2", label: "R2", sub: IC_ADDR["R2:TRANSIT"], icon: "R", x: 64, y: 58 },
  { id: "b", label: "HOST-B", sub: IC_ADDR["HOST-B"], icon: "💻", x: 91, y: 58 },
];
const at = (n: string) => nodeAt(NODES, n);

function IcmpDeck({ step: s, play, replay, ttl, setTtl }: { step: Step; play: number; replay: () => void; ttl: number; setTtl: (n: number) => void }) {
  const id = s.id;
  const k = `${id}-${play}-${ttl}`;
  const head = <StageHead chapter={s.chapter} title={s.title} />;
  const go = (f: string, t: string, o: { label: string; key: string; delay?: number; stay?: boolean; color?: string; d?: number }) => (
    <Mover key={`${k}-${o.key}`} from={at(f)} to={o.stay ? short(at(f), at(t)) : at(t)} delay={o.delay} duration={o.d ?? 750} stay={o.stay}>
      <Token color={o.color ?? "cyan"}>{o.label}</Token>
    </Mover>
  );
  const showMtu = ["mtu", "df", "symptom", "verify", "block"].includes(id);
  const links: TopoLink[] = [
    { a: "a", b: "r1", label: showMtu ? "MTU 1500" : undefined },
    { a: "r1", b: "r2", label: showMtu ? `MTU ${FAULT_MTU}` : undefined, state: showMtu ? "blocked" : "up" },
    { a: "r2", b: "b", label: showMtu ? "MTU 1500" : undefined },
  ];

  if (VISUAL[id] === "net") {
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    let table: ReactNode = null;
    if (id === "why") {
      movers = (
        <>
          {go("a", "r1", { label: "packet", key: "1" })}
          {go("r1", "r2", { label: "packet", key: "2", delay: 750, stay: true, color: "red" })}
        </>
      );
      views.r2 = { ring: "bad", bubble: { text: "can't forward → drop", tone: "bad", delay: 1400 } };
      views.a = { ring: "on", bubble: { text: "…did it arrive? why not?", tone: "ask", delay: 1600 } };
    }
    if (id === "ping" || id === "ttl") {
      movers = (
        <>
          {go("a", "r1", { label: `Echo 8/0 · TTL ${INITIAL_TTL}`, key: "1" })}
          {go("r1", "r2", { label: `TTL ${INITIAL_TTL - 1}`, key: "2", delay: 750 })}
          {go("r2", "b", { label: `TTL ${INITIAL_TTL - 2}`, key: "3", delay: 1500, stay: true })}
        </>
      );
      if (id === "ttl") {
        views.r1 = { badge: { text: "−1", tone: "warn" }, bubble: { text: `${INITIAL_TTL} → ${INITIAL_TTL - 1}`, tone: "info", delay: 600 } };
        views.r2 = { badge: { text: "−1", tone: "warn" }, bubble: { text: `${INITIAL_TTL - 1} → ${INITIAL_TTL - 2}`, tone: "info", delay: 1350 } };
        views.b = { bubble: { text: "host: no decrement", tone: "no", delay: 2100 } };
      } else views.b = { ring: "target", bubble: { text: `id ${ECHO_IDENTIFIER} · seq 1`, tone: "info", delay: 2100 } };
    }
    if (id === "reply") {
      movers = (
        <>
          {go("b", "r2", { label: "Echo Reply 0/0", key: "1", color: "green" })}
          {go("r2", "r1", { label: "0/0", key: "2", delay: 750, color: "green" })}
          {go("r1", "a", { label: "0/0", key: "3", delay: 1500, stay: true, color: "green" })}
        </>
      );
      views.a = { ring: "target", bubble: { text: `matches id ${ECHO_IDENTIFIER} seq 1 ✓ · RTT measured`, tone: "yes", delay: 2200 } };
    }
    if (id === "expire") {
      movers = (
        <>
          {go("a", "r1", { label: "TTL 1", key: "1", color: "amber" })}
          {go("r1", "a", { label: "Time Exceeded 11/0", key: "2", delay: 1100, stay: true, color: "red" })}
        </>
      );
      views.r1 = { ring: "hit", bubble: { text: "TTL 1 → can't forward → drop", tone: "bad", delay: 650 } };
    }
    if (id === "trace") {
      const hops: [string, string][] = [
        ["r1", IC_ADDR["R1:LAN"]],
        ["r2", IC_ADDR["R2:TRANSIT"]],
        ["b", IC_ADDR["HOST-B"]],
      ];
      const target = hops[ttl - 1][0];
      const path = ["a", "r1", "r2", "b"];
      const idx = path.indexOf(target);
      movers = (
        <>
          {path.slice(0, idx).map((n, i) => go(n, path[i + 1], { label: `TTL ${ttl - i}`, key: `o${i}`, delay: i * 650, d: 650, color: "amber" }))}
          {path
            .slice(1, idx + 1)
            .reverse()
            .map((n, i, arr) => go(n, arr[i + 1] ?? "a", { label: ttl === 3 ? "Echo Reply" : "11/0", key: `b${i}`, delay: idx * 650 + 300 + i * 650, d: 650, stay: i === arr.length - 1, color: ttl === 3 ? "green" : "red" }))}
        </>
      );
      views[target] = { ring: ttl === 3 ? "target" : "hit", bubble: { text: ttl === 3 ? "destination: Echo Reply" : "TTL expired here: 11/0", tone: ttl === 3 ? "yes" : "bad", delay: idx * 650 } };
      table = <MiniTable title="traceroute output" cols={["TTL", "Answered by", "Message"]} rows={hops.slice(0, ttl).map(([, addr], i) => ({ cells: [String(i + 1), addr, i === 2 ? "Echo Reply 0/0" : "Time Exceeded 11/0"], state: i === ttl - 1 ? "new" : undefined }))} />;
    }
    if (id === "mtu") {
      views.r1 = { bubble: { text: `ge-0/0/1 IP MTU ${FAULT_MTU}`, tone: "warn" } };
    }
    if (id === "df" || id === "symptom") {
      movers = (
        <>
          {go("a", "r1", { label: `${BIG_TOTAL} B · DF`, key: "1", color: "amber" })}
          {go("r1", "a", { label: `3/4 · next-hop MTU ${FAULT_MTU}`, key: "2", delay: 1100, stay: true, color: "red" })}
          {id === "symptom" && go("a", "b", { label: `${PING_DATA + 28} B ping ✓`, key: "3", delay: 2600, d: 1600, stay: true, color: "green" })}
        </>
      );
      views.r1 = { ring: "bad", bubble: { text: `${BIG_TOTAL} > ${FAULT_MTU}, DF set → drop`, tone: "bad", delay: 650 } };
    }
    if (id === "verify") {
      movers = (
        <>
          {go("a", "r1", { label: `${FAULT_MTU} B · DF`, key: "1" })}
          {go("r1", "r2", { label: `${FAULT_MTU} B`, key: "2", delay: 750 })}
          {go("r2", "b", { label: `${FAULT_MTU} B`, key: "3", delay: 1500, stay: true })}
          {go("b", "a", { label: "Echo Reply ✓", key: "4", delay: 2400, d: 1500, stay: true, color: "green" })}
        </>
      );
      views.r1 = { bubble: { text: `${FAULT_MTU} ≤ ${FAULT_MTU} ✓`, tone: "yes", delay: 600 } };
    }
    if (id === "block") {
      movers = (
        <>
          {go("a", "r1", { label: `${BIG_TOTAL} B · DF`, key: "1", color: "amber" })}
          {go("r1", "a", { label: "3/4", key: "2", delay: 1100, d: 500, color: "red" })}
        </>
      );
      views.r1 = { ring: "bad", bubble: { text: "drops, sends 3/4…", tone: "bad", delay: 650 } };
      views.a = { ring: "hit", bubble: { text: "firewall ate the 3/4: big packets just vanish", tone: "bad", delay: 1700 } };
    }
    const animated = !["mtu"].includes(id);
    return (
      <>
        {head}
        {id === "trace" && <Pills label="TTL" options={[1, 2, 3].map((n) => ({ v: n, label: `TTL ${n}` }))} value={ttl} onPick={setTtl} />}
        <Topo nodes={NODES} links={links} views={views} ratio={30} minH={190}>
          {movers}
        </Topo>
        {table}
        {id === "symptom" && <Compare items={[{ title: `ping, ${PING_DATA} B data`, tone: "green", body: "reply ✓" }, { title: `ping -s ${BIG_DATA} with DF`, tone: "red", body: "fails · 3/4 from R1" }]} />}
        {animated && <ReplayButton onClick={replay} />}
      </>
    );
  }

  switch (id) {
    case "what":
      return (
        <>
          {head}
          <PacketCard
            layers={[
              { name: "IPv4", color: "#a78bfa", fields: [{ k: "Protocol", v: "1 = ICMP", hi: "key" }, { k: "Src", v: IC_ADDR["HOST-A"] }, { k: "Dst", v: IC_ADDR["HOST-B"] }, { k: "TTL", v: INITIAL_TTL }] },
              { name: "ICMP (no ports)", color: "#fbbf24", fields: [{ k: "Type / Code", v: "8 / 0 (Echo Request)", hi: "key" }, { k: "Checksum", v: "…" }, { k: "Identifier", v: ECHO_IDENTIFIER }, { k: "Sequence", v: 1 }, { k: "Data", v: `${PING_DATA} B` }] },
            ]}
          />
          <Compare items={[{ title: "Queries", tone: "cyan", body: "Echo Request / Echo Reply: “are you there?”" }, { title: "Errors", tone: "red", body: "Time Exceeded, Destination Unreachable: “I dropped your packet, because…”" }]} />
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain
            k="ts"
            items={[
              { t: "Symptom: some transfers hang", tone: "red" },
              { t: `Test: small ping ✓ · ${BIG_DATA} B DF ping ✕`, tone: "plain" },
              { t: `Evidence: ICMP 3/4 from ${IC_ADDR["R1:LAN"]}`, tone: "amber" },
              { t: `Evidence: next-hop MTU = ${FAULT_MTU}`, tone: "amber" },
              { t: "Hypothesis: packets bigger than the transit MTU", tone: "violet" },
              { t: `Root cause: R1–R2 link IP MTU ${FAULT_MTU}`, tone: "violet" },
            ]}
          />
        </>
      );
    case "math":
      return (
        <>
          {head}
          <Lines k="m" lines={["IPv4 header   20", "ICMP header    8", `data       ${FIXED_DATA}`, `total      ${FAULT_MTU} ✓`]} />
          <Compare items={[{ title: "Before", tone: "red", body: `20 + 8 + ${BIG_DATA} = ${BIG_TOTAL} > ${FAULT_MTU}` }, { title: "After", tone: "green", body: `20 + 8 + ${FIXED_DATA} = ${FAULT_MTU}` }]} />
        </>
      );
    case "types":
      return (
        <>
          {head}
          <MiniTable
            title="Common ICMP messages"
            cols={["Type/Code", "Name", "Sent by / when"]}
            rows={[
              { cells: ["8 / 0", "Echo Request", "ping, traceroute here"] },
              { cells: ["0 / 0", "Echo Reply", "the destination answers"] },
              { cells: ["11 / 0", "Time Exceeded", "router: TTL ran out"], state: "hit" },
              { cells: ["3 / 0", "Net Unreachable", "router: no route"] },
              { cells: ["3 / 1", "Host Unreachable", "last router: host not answering ARP"] },
              { cells: ["3 / 3", "Port Unreachable", "host: nothing listening (UDP)"] },
              { cells: ["3 / 4", "Fragmentation Needed", "router: too big with DF, carries next-hop MTU"], state: "bad" },
            ]}
          />
        </>
      );
    case "proves":
      return (
        <>
          {head}
          <Compare items={[{ title: "Proven by one Echo Reply", tone: "green", body: "the request reached HOST-B · the reply came back · for this packet size and type" }, { title: "Not proven", tone: "red", body: "the web app works · 1500-byte packets fit · no loss at all · DNS works" }]} />
          <Compare items={[{ title: "Ping failed", tone: "amber", body: "something dropped the request or the reply — or chose not to answer" }, { title: "…which does NOT mean", tone: "red", body: "“the host is down” or “the network is broken”" }]} />
        </>
      );
    case "unreach":
      return (
        <>
          {head}
          <MiniTable
            title="Destination Unreachable, from where"
            cols={["Code", "Sent by", "Means"]}
            rows={[
              { cells: ["3 / 0 Net", "R1 (no route)", "nobody routes that network"] },
              { cells: ["3 / 1 Host", "R2 (ARP got no answer)", "the network exists, the host doesn't answer"], state: "hit" },
              { cells: ["3 / 3 Port", "HOST-B itself", "reached — nothing listens on that UDP port"] },
              { cells: ["3 / 4 Frag needed", "the router before the small link", "too big with DF: here is the MTU"], state: "bad" },
            ]}
          />
        </>
      );
    case "silence":
      return (
        <>
          {head}
          <MiniTable
            title="Patterns of silence"
            cols={["You see", "Look at"]}
            rows={[
              { cells: ["R1 answers, then nothing", "beyond R1 — and the way back through R2"] },
              { cells: ["R2 answers, then nothing", "HOST-B, its firewall"] },
              { cells: ["Nothing answers at all", "HOST-A's own link and gateway"] },
              { cells: ["Request reaches HOST-B, no reply", "the return path"], state: "bad" },
              { cells: ["Small works, big hangs", "MTU + filtered 3/4 (PMTUD black hole)"], state: "hit" },
            ]}
          />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain
            k="recap"
            items={[
              { t: "IP can't report problems by itself" },
              { t: "ICMP rides in IP (Protocol 1, no ports)", tone: "violet" },
              { t: "Echo 8/0 ↔ 0/0: the path works both ways", tone: "green" },
              { t: "TTL −1 per router → 11/0 when it runs out", tone: "amber" },
              { t: "traceroute = TTL 1, 2, 3… on purpose", tone: "cyan" },
              { t: "Too big + DF → 3/4 with the next-hop MTU", tone: "red" },
              { t: "Silence is evidence: where was it last seen?", tone: "amber" },
              { t: "Read the ICMP message, then fix and verify", tone: "green" },
            ]}
          />
        </>
      );
  }
  return head;
}

export function IcmpPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  const [ttl, setTtl] = useState(1);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="ICMP, from zero"
      kicker="Learn · the ICMP presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id]}
      renderStage={(s) => <IcmpDeck step={s} play={play} replay={() => setPlay((p) => p + 1)} ttl={ttl} setTtl={setTtl} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
