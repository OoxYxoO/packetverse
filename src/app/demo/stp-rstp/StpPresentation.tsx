"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, PacketCard, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";

/**
 * STP/RSTP — the presentation before the lesson/lab. Builds on Switching (a second link between switches = a loop,
 * Ethernet has no TTL): the same idea with three switches in a triangle (SW1 priority 24576, SW2/SW3 32768, every link
 * cost 20000), the election, Root / Designated / Alternate ports, failover and timers, edge ports, guards, and the
 * port taken out of spanning tree. Presentation state only.
 */

type Id = "why" | "cure" | "bpdu" | "claims" | "election" | "tie" | "rp" | "recv" | "dp" | "alt" | "tree" | "fail" | "legacy" | "edge" | "tc" | "rogue" | "guards" | "off" | "verify" | "trouble" | "recap";
type Step = DeckStep & { id: Id };
const Bb = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;

const STEPS: Step[] = [
  { id: "why", chapter: "Why spanning tree", title: "Redundant cables make a loop.", body: <p>Three switches cabled in a triangle survive any one cable failure. But with every port forwarding, one broadcast goes round forever — exactly the Switching incident, with no TTL to stop it.</p> },
  { id: "cure", chapter: "Why spanning tree", title: "Keep every cable; block one port.", body: <p>Spanning tree lets the switches agree on a <Bb>tree</Bb>: one path between any two switches. Here one port — SW3&apos;s end of the SW2–SW3 link — refuses to forward data. The cable stays up, ready.</p> },
  { id: "bpdu", chapter: "How switches agree", title: "BPDUs: “I think the root is X, at cost Y.”", body: <p>Every 2 s each switch sends <Bb>BPDUs</Bb> to the multicast MAC 01:80:C2:00:00:00. They are not IP and are never forwarded as data: each switch reads them, decides, and sends its own.</p> },
  { id: "claims", chapter: "Electing the root", title: "At first, every switch claims to be root.", body: <p>Each switch starts by advertising itself as root at cost 0. As BPDUs arrive, a switch that hears a better root stops claiming and repeats the better one instead.</p> },
  { id: "election", chapter: "Electing the root", title: "Lowest Bridge ID wins.", body: <p>Bridge ID = <Bb>priority</Bb> (default 32768, set in steps of 4096) + the switch&apos;s <Bb>MAC</Bb>. SW1 was given 24576: it is root. Engineers set priorities on purpose — the root should be the core switch, not an accident.</p> },
  { id: "tie", chapter: "Electing the root", title: "Same priority? The MAC breaks the tie.", body: <p>SW2 and SW3 both have 32768. SW2&apos;s MAC (…53:02) is lower than SW3&apos;s (…53:03), so SW2 is “better” whenever the two are compared — that decides the SW2–SW3 link.</p> },
  { id: "rp", chapter: "Root ports", title: "Each switch picks its cheapest way to the root.", body: <p>The root advertises cost 0. SW3 hears it directly (0 + 20000) and via SW2 (20000 + 20000). The cheaper wins: SW3&apos;s link to SW1 is its <Bb>Root Port</Bb>. Every non-root switch has exactly one.</p> },
  { id: "recv", chapter: "Root ports", title: "The cost is added where the BPDU arrives.", body: <p>Raise the cost on <Bb>SW3&apos;s</Bb> port toward SW1 to 200000, and SW3 prefers the path via SW2 (40000). Raising it on SW1&apos;s port would change nothing: the root advertises 0 out of every port.</p> },
  { id: "dp", chapter: "Designated and Alternate", title: "On every link, one end is Designated.", body: <p>The end with the better offer — lower root cost, then lower Bridge ID — forwards onto that link: the <Bb>Designated</Bb> port. The root&apos;s ports are always Designated. On SW2–SW3 both offer 20000; SW2 wins on Bridge ID.</p> },
  { id: "alt", chapter: "Designated and Alternate", title: "The leftover end is Alternate: Discarding, still listening.", body: <p>SW3&apos;s end of SW2–SW3 is neither Root nor Designated: <Bb>Alternate</Bb>. It drops every data frame in both directions, but keeps receiving SW2&apos;s BPDUs. It is a backup path, already computed.</p> },
  { id: "tree", chapter: "The result", title: "Three switches, two forwarding links: a tree.", body: <p>HOST-C → HOST-B now goes SW3 → SW1 → SW2, never across the blocked link. A broadcast reaches every host exactly once.</p> },
  { id: "fail", chapter: "When a link fails", title: "RSTP: the Alternate takes over at once.", body: <p>Cut SW1–SW3. SW3 loses its Root Port, and its Alternate port becomes Root Port <Bb>immediately</Bb>: RSTP had it ready. Between RSTP switches, a port that must start forwarding asks its neighbor (proposal) and forwards as soon as it agrees.</p> },
  { id: "legacy", chapter: "When a link fails", title: "Legacy STP waits 30–50 seconds.", body: <p>The original 802.1D STP has no Alternate role and no handshake: a port goes <Bb>Listening</Bb> 15 s, <Bb>Learning</Bb> 15 s, then Forwarding — plus 20 s of max age when the failure is indirect. That outage is why RSTP replaced it.</p> },
  { id: "edge", chapter: "Host ports", title: "Edge ports forward at once.", body: <p>A PC never answers RSTP&apos;s proposal, so a normal port toward a PC waits 30 s every time the link comes up. Marking host ports <Bb>edge</Bb> (Cisco portfast · Junos edge) skips the wait — and the port stops being edge the moment a BPDU shows up.</p> },
  { id: "tc", chapter: "Topology changes", title: "A change flushes the MAC tables.", body: <p>When a non-edge port starts forwarding, switches send a <Bb>topology change</Bb>: everyone flushes MAC entries learned on non-edge ports, so frames are flooded once and find the new path. Edge ports going up and down don&apos;t cause this.</p> },
  { id: "rogue", chapter: "Protecting the tree", title: "A stray switch with a low priority becomes root.", body: <p>Someone plugs a small switch (priority 4096) into a spare port on SW3. It wins the election: every switch re-points toward SW3 and SW1↔SW2 traffic detours through it. Spanning tree trusts every BPDU.</p> },
  { id: "guards", chapter: "Protecting the tree", title: "BPDU guard and root guard.", body: <p>Two protections for ports where no switch belongs (or no better root may appear).</p> },
  { id: "off", chapter: "Protecting the tree", title: "A port taken out of spanning tree loops the network.", body: <p>BPDU filter (Cisco) or rstp interface … disable (Junos) on a switch-facing port: it sends and hears no BPDUs, nothing can block it, and the triangle loops again.</p> },
  { id: "verify", chapter: "Verify on the devices", title: "Read the tree from each switch.", body: <p>Who is root? What is my Root Port and cost? What role and state is every port in?</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Read the tree before you touch it.", body: <p>Spanning-tree problems show up as loops, detours, or outages after a change.</p> },
  { id: "recap", chapter: "The whole idea", title: "Elect a root, point at it, block the rest.", body: <p>Now watch it converge in the lesson, then break and protect it in the STP Lab.</p> },
];
const VISUAL: Record<Id, string> = { why: "net", cure: "net", bpdu: "bpdu", claims: "net", election: "election", tie: "election", rp: "net", recv: "net", dp: "net", alt: "net", tree: "net", fail: "net", legacy: "legacy", edge: "net", tc: "net", rogue: "net", guards: "guards", off: "net", verify: "verify", trouble: "trouble", recap: "recap" };

const NODES: TopoNode[] = [
  { id: "sw1", label: "SW1", sub: "24576", icon: "⇄", x: 50, y: 18 },
  { id: "sw2", label: "SW2", sub: "32768", icon: "⇄", x: 22, y: 70 },
  { id: "sw3", label: "SW3", sub: "32768", icon: "⇄", x: 78, y: 70 },
  { id: "a", label: "HOST-A", icon: "💻", x: 16, y: 16 },
  { id: "b", label: "HOST-B", icon: "💻", x: 6, y: 96 },
  { id: "c", label: "HOST-C", icon: "💻", x: 94, y: 96 },
  { id: "rg", label: "small switch", sub: "4096", icon: "⇄", x: 96, y: 40 },
];
const at = (n: string) => nodeAt(NODES, n);

function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const id = s.id;
  const k = `${id}-${play}`;
  const head = <StageHead chapter={s.chapter} title={s.title} />;
  const go = (f: string, t: string, o: { label: string; key: string; delay?: number; stay?: boolean; color?: string; d?: number }) => {
    const from = at(f);
    const to = at(t);
    return (
      <Mover key={`${k}-${o.key}`} from={from} to={o.stay ? short(from, to) : to} delay={o.delay} duration={o.d ?? 700} stay={o.stay}>
        <Token color={o.color ?? "cyan"}>{o.label}</Token>
      </Mover>
    );
  };
  if (VISUAL[id] === "net") {
    const noStp = id === "why" || id === "off";
    const failed = id === "fail";
    const reRoot = id === "rogue";
    const altL23 = !noStp && !failed && !reRoot && id !== "claims";
    const links: TopoLink[] = [
      { a: "sw1", b: "sw2", label: reRoot ? "DP │ ALT" : "DP │ RP", state: noStp ? "active" : reRoot ? "blocked" : "up" },
      { a: "sw1", b: "sw3", label: failed ? "unplugged" : reRoot ? "RP │ DP" : id === "recv" ? "DP │ ALT (cost 200000)" : "DP │ RP", state: failed ? "down" : noStp ? "active" : id === "recv" ? "blocked" : "up" },
      { a: "sw2", b: "sw3", label: failed ? "DP │ RP (took over)" : reRoot ? "RP │ DP" : id === "recv" ? "DP │ RP" : altL23 ? "DP │ ALT" : "", state: noStp ? "active" : failed ? "active" : altL23 && id !== "recv" ? "blocked" : "up" },
      { a: "sw1", b: "a", label: "edge" },
      { a: "sw2", b: "b", label: "edge" },
      { a: "sw3", b: "c", label: "edge" },
      ...(reRoot ? [{ a: "sw3", b: "rg", label: "spare port", state: "active" as const }] : []),
    ];
    const nodes = reRoot ? NODES : NODES.filter((n) => n.id !== "rg");
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "why" || id === "off") {
      movers = (
        <>
          {go("a", "sw1", { label: "FF:FF…", key: "0", d: 500, color: "amber" })}
          {[0, 1, 2].map((w) => (
            <span key={w}>
              {go("sw1", "sw2", { label: `lap ${w + 1}`, key: `a${w}`, delay: 500 + w * 2100, color: "red" })}
              {go("sw2", "sw3", { label: `lap ${w + 1}`, key: `b${w}`, delay: 1200 + w * 2100, color: "red" })}
              {go("sw3", "sw1", { label: `lap ${w + 1}`, key: `c${w}`, delay: 1900 + w * 2100, color: "red" })}
            </span>
          ))}
        </>
      );
      views.sw2 = { ring: "bad", bubble: { text: id === "off" ? "SW3 sends no BPDUs → I forward" : "flood, flood, flood…", tone: "bad", delay: 1200 } };
      if (id === "off") views.sw3 = { ring: "bad", bubble: { text: "ge-0/0/2: out of spanning tree", tone: "bad" } };
    }
    if (id === "cure") views.sw3 = { ring: "on", bubble: { text: "ge-0/0/2: Alternate · Discarding", tone: "warn" } };
    if (id === "claims") {
      views.sw1 = { bubble: { text: "root = me (24576)", tone: "info" } };
      views.sw2 = { bubble: { text: "root = me (32768)", tone: "info", delay: 200 } };
      views.sw3 = { bubble: { text: "root = me (32768)", tone: "info", delay: 400 } };
      movers = (
        <>
          {go("sw1", "sw2", { label: "root SW1 · 0", key: "1", delay: 900, color: "violet" })}
          {go("sw1", "sw3", { label: "root SW1 · 0", key: "2", delay: 900, color: "violet" })}
        </>
      );
    }
    if (id === "rp" || id === "recv") {
      movers = (
        <>
          {go("sw1", "sw2", { label: "cost 0", key: "1", color: "violet" })}
          {go("sw1", "sw3", { label: "cost 0", key: "2", color: "violet" })}
          {go("sw2", "sw3", { label: "cost 20000", key: "3", delay: 900, color: "violet" })}
        </>
      );
      views.sw3 = { ring: "on", bubble: id === "rp" ? { text: "direct 0+20000 · via SW2 20000+20000 → direct wins", tone: "yes", delay: 1500 } : { text: "direct 0+200000 · via SW2 40000 → via SW2", tone: "warn", delay: 1500 } };
    }
    if (id === "dp") views.sw2 = { ring: "on", bubble: { text: "SW2–SW3: both cost 20000 → SW2's lower ID wins → my end Designated", tone: "yes" } };
    if (id === "alt") {
      movers = (
        <>
          {go("b", "sw2", { label: "FF:FF…", key: "1", color: "amber" })}
          {go("sw2", "sw3", { label: "FF:FF…", key: "2", delay: 700, stay: true, color: "amber" })}
          {go("sw2", "sw3", { label: "BPDU", key: "3", delay: 1900, color: "violet" })}
        </>
      );
      views.sw3 = { ring: "bad", bubble: { text: "data: discarded · BPDU: heard", tone: "warn", delay: 1300 } };
    }
    if (id === "tree") {
      movers = (
        <>
          {go("c", "sw3", { label: "to B", key: "1" })}
          {go("sw3", "sw1", { label: "to B", key: "2", delay: 700 })}
          {go("sw1", "sw2", { label: "to B", key: "3", delay: 1400 })}
          {go("sw2", "b", { label: "to B", key: "4", delay: 2100, stay: true })}
        </>
      );
    }
    if (id === "fail") {
      movers = (
        <>
          {go("c", "sw3", { label: "ping", key: "1", delay: 400 })}
          {go("sw3", "sw2", { label: "ping", key: "2", delay: 1100 })}
          {go("sw2", "sw1", { label: "ping", key: "3", delay: 1800 })}
          {go("sw1", "a", { label: "ping", key: "4", delay: 2500, stay: true })}
        </>
      );
      views.sw3 = { ring: "on", bubble: { text: "Alternate → Root Port, now", tone: "yes" } };
    }
    if (id === "edge") {
      views.b = { bubble: { text: "cable in → edge port forwards at once", tone: "yes" } };
      views.sw2 = { bubble: { text: "not edge → 30 s wait", tone: "warn", delay: 600 } };
    }
    if (id === "tc") {
      views.sw1 = { bubble: { text: "TC → flush", tone: "warn" } };
      views.sw2 = { bubble: { text: "TC → flush", tone: "warn", delay: 300 } };
      views.sw3 = { bubble: { text: "TC → flush", tone: "warn", delay: 600 } };
    }
    if (id === "rogue") {
      views.rg = { ring: "bad", bubble: { text: "priority 4096 → I'm root", tone: "bad" } };
      views.sw1 = { ring: "bad", bubble: { text: "not root any more", tone: "bad", delay: 600 } };
      movers = (
        <>
          {go("a", "sw1", { label: "to B", key: "1", delay: 900 })}
          {go("sw1", "sw3", { label: "to B", key: "2", delay: 1600 })}
          {go("sw3", "sw2", { label: "to B", key: "3", delay: 2300 })}
          {go("sw2", "b", { label: "to B", key: "4", delay: 3000, stay: true })}
        </>
      );
    }
    views.sw1 = views.sw1 ?? (noStp ? {} : reRoot ? {} : { badge: { text: "root", tone: "yes" } });
    return (
      <>
        {head}
        <Topo nodes={nodes} links={links} views={views} ratio={50} minH={250}>
          {movers}
        </Topo>
        {["why", "off", "claims", "rp", "recv", "alt", "tree", "fail", "rogue"].includes(id) && <ReplayButton onClick={replay} />}
      </>
    );
  }
  switch (id) {
    case "bpdu":
      return (
        <>
          {head}
          <PacketCard
            layers={[
              { name: "IEEE 802.3 frame", color: "#94a3b8", fields: [{ k: "Destination", v: "01:80:C2:00:00:00" }, { k: "Source", v: "SW2's MAC" }, { k: "LLC", v: "0x42 0x42 0x03" }] },
              { name: "RST BPDU", color: "#a78bfa", fields: [{ k: "Root ID", v: "24576 · SW1", hi: "key" }, { k: "Root path cost", v: "20000", hi: "key" }, { k: "Bridge ID", v: "32768 · SW2" }, { k: "Port ID", v: "128.2" }, { k: "Flags", v: "role · state · TC" }, { k: "Hello / Max age / Fwd delay", v: "2 / 20 / 15 s" }] },
            ]}
          />
          <Compare items={[{ title: "Data frames", tone: "cyan", body: "forwarded, flooded, learned from" }, { title: "BPDUs", tone: "violet", body: "consumed by each switch — never forwarded as data" }]} />
        </>
      );
    case "election":
    case "tie":
      return (
        <>
          {head}
          <MiniTable title="Bridge IDs, lowest first" cols={["Bridge", "Priority", "MAC", ""]} rows={[{ cells: ["SW1", "24576", "00:00:5E:00:53:01", "root"], state: "best" }, { cells: ["SW2", "32768", "00:00:5E:00:53:02", id === "tie" ? "wins the tie" : ""], state: id === "tie" ? "hit" : undefined }, { cells: ["SW3", "32768", "00:00:5E:00:53:03", ""] }]} />
          <Compare items={[{ title: "Priority first", tone: "green", body: "0 … 61440, multiples of 4096" }, { title: "MAC second", tone: "amber", body: "only when priorities are equal" }]} />
        </>
      );
    case "legacy":
      return (
        <>
          {head}
          <Chain
            k="lg"
            horizontal
            items={[
              { t: "link fails", tone: "red" },
              { t: "(+20 s max age if indirect)", tone: "plain" },
              { t: "Listening 15 s", tone: "amber" },
              { t: "Learning 15 s", tone: "amber" },
              { t: "Forwarding", tone: "green" },
            ]}
          />
          <Compare items={[{ title: "802.1D STP", tone: "amber", body: "30–50 s without forwarding" }, { title: "RSTP (802.1w)", tone: "green", body: "Alternate → Root at once; proposal/agreement on switch links" }]} />
        </>
      );
    case "guards":
      return (
        <>
          {head}
          <Compare
            items={[
              { title: "BPDU guard", tone: "red", body: "any BPDU → err-disable the port (Cisco spanning-tree bpduguard enable · Junos layer2-control bpdu-block). For host ports: no switch belongs here." },
              { title: "Root guard", tone: "violet", body: "a better root offered → block the port (root-inconsistent) until it stops (Cisco spanning-tree guard root · Junos no-root-port). For ports toward switches that must never become root." },
            ]}
          />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniTable title="Cisco IOS (Rapid PVST+)" cols={["Question", "Command"]} rows={[{ cells: ["Root, my RP, every port", "show spanning-tree"] }, { cells: ["Root per VLAN", "show spanning-tree root"] }, { cells: ["What's blocked", "show spanning-tree blockedports"] }, { cells: ["One port, BPDUs sent/received", "show spanning-tree interface Gi1/0/2 detail"] }, { cells: ["Topology changes", "show spanning-tree detail"] }]} />
            <MiniTable title="Junos (RSTP)" cols={["Question", "Command"]} rows={[{ cells: ["Root ID, root cost, root port", "show spanning-tree bridge"] }, { cells: ["Every port: role, state, cost", "show spanning-tree interface"] }, { cells: ["Configuration", "show configuration protocols rstp"] }, { cells: ["BPDU-protected port shut", "show interfaces terse"] }, { cells: ["Re-enable it", "clear error bpdu interface ge-0/0/11"] }]} />
          </div>
          <Compare items={[{ title: "Cisco", tone: "cyan", body: "priority shown + sys-id-ext (VLAN 1 → 24577); roles Root/Desg/Altn, states FWD/BLK/LRN" }, { title: "Junos", tone: "violet", body: "Bridge ID as 24576.MAC; roles ROOT/DESG/ALT; changes need commit" }]} />
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain
            k="ts"
            items={[
              { t: "Symptom: loop (duplicates, MAC moves), detour (slow path), or outage after a change", tone: "red" },
              { t: "Who is root — the switch you designed? (show spanning-tree root / bridge)", tone: "cyan" },
              { t: "Is each Root Port the expected one? (costs on receiving ports)", tone: "cyan" },
              { t: "Exactly one blocked port per loop? Any port out of STP?", tone: "amber" },
              { t: "Timers: legacy STP? host port not edge?", tone: "amber" },
              { t: "Guards: err-disabled / root-inconsistent ports?", tone: "violet" },
              { t: "Fix one thing, then prove it with traffic", tone: "green" },
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
              { t: "BPDUs carry root, cost, sender — switches decide together" },
              { t: "Lowest Bridge ID (priority, then MAC) is root", tone: "green" },
              { t: "Root Port = cheapest path; cost counted on receiving ports", tone: "cyan" },
              { t: "Designated forwards onto each link; Alternate discards, keeps listening", tone: "amber" },
              { t: "RSTP repairs at once; legacy STP 30–50 s; host ports edge", tone: "violet" },
              { t: "Guards stop stray switches; a port out of STP can loop everything", tone: "red" },
            ]}
          />
        </>
      );
  }
  return head;
}

export function StpPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="Spanning tree, from zero"
      kicker="Learn · the STP presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id]}
      renderStage={(s) => <Deck step={s} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
