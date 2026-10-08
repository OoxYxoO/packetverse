"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, ReplayButton, Token, Topo, nodeAt, short, type TableRow, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { PRIMARY_PORT, SECONDARY_PORT, SWF_MAC } from "@/lib/sim-engine/scenarios/switchingFundamentals";

/**
 * SWITCHING FUNDAMENTALS — the presentation before the lesson/lab: two learning bridges in one broadcast domain
 * (HOST-A, HOST-D on SW1; HOST-B, HOST-C on SW2; uplink ge-0/0/23) and the incident (a second uplink ge-0/0/24 with
 * no loop prevention → a broadcast loop, MAC flapping). Presentation state only.
 */

const sm = (m: string) => `…${m.slice(-5)}`;
const A = SWF_MAC["HOST-A"];
const Bm = SWF_MAC["HOST-B"];
const D = SWF_MAC["HOST-D"];

type Id = "why" | "own" | "a-sends" | "sw2" | "filter" | "reply" | "tables" | "local" | "bcast" | "change" | "redundant" | "loop" | "no-ttl" | "storm" | "flap" | "trouble" | "fix" | "stp" | "recap";
type Step = DeckStep & { id: Id };
const Bb = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;

const STEPS: Step[] = [
  { id: "why", chapter: "Why several switches", title: "One switch isn't enough: connect two.", body: <p>Hosts sit on different floors, or one switch runs out of ports. SW1 and SW2 are joined by an uplink ({PRIMARY_PORT}). Together they are still <Bb>one LAN</Bb>, one broadcast domain.</p> },
  { id: "own", chapter: "Each switch thinks alone", title: "Every switch keeps its own MAC table.", body: <p>Nothing synchronizes SW1 and SW2. Each one learns only from frames that arrive on <Bb>its own</Bb> ports, exactly as in the Ethernet lesson.</p> },
  { id: "a-sends", chapter: "First frame", title: "HOST-A sends to HOST-B: SW1 learns, then floods.", body: <p>SW1 learns <Bb>{sm(A)} → ge-0/0/1</Bb>. HOST-B is unknown, so it floods: out to HOST-D <i>and</i> up the uplink to SW2.</p> },
  { id: "sw2", chapter: "First frame", title: "SW2 learns HOST-A behind its uplink.", body: <p>The copy arrives on SW2&apos;s {PRIMARY_PORT}. SW2 learns <Bb>{sm(A)} → {PRIMARY_PORT}</Bb>: from SW2&apos;s point of view, HOST-A lives “up that cable”. HOST-B is unknown to SW2 too, so it floods again.</p> },
  { id: "filter", chapter: "First frame", title: "Only HOST-B keeps it.", body: <p>HOST-D and HOST-C discard the flooded copy (not their MAC). HOST-B accepts it.</p> },
  { id: "reply", chapter: "The reply", title: "HOST-B replies: both switches learn HOST-B.", body: <p>SW2 learns B on ge-0/0/1 and already knows A (uplink), so the reply goes up the uplink only. SW1 learns <Bb>B → {PRIMARY_PORT}</Bb> and sends it out ge-0/0/1 to HOST-A only.</p> },
  { id: "tables", chapter: "Two tables", title: "Same MACs, different ports, different tables.", body: <p>Each switch maps a MAC to <Bb>its own</Bb> port toward it. Many MACs can share one uplink port.</p> },
  { id: "local", chapter: "Local traffic", title: "HOST-D ↔ HOST-A never leaves SW1.", body: <p>Once SW1 knows both, their frames use only SW1&apos;s access ports. SW2 never sees them, and so never learns HOST-D. Knowledge is partial, and that&apos;s fine.</p> },
  { id: "bcast", chapter: "Broadcast", title: "A broadcast crosses every switch.", body: <p>HOST-D sends a broadcast (an ARP request). FF:FF:FF:FF:FF:FF is flooded by SW1 (including the uplink), then by SW2: every host in the broadcast domain receives it — and SW2 now learns HOST-D behind its uplink.</p> },
  { id: "change", chapter: "Tables change", title: "Learned entries don't last forever.", body: <p>An entry is removed after <Bb>300 s</Bb> without a frame from that MAC, and flushed when its port goes down. If a quiet host moves — HOST-D re-cabled to SW2 — SW1 forgets it, but SW2 still points it at the uplink: <Bb>stale</Bb>, until HOST-D sends something.</p> },
  { id: "redundant", chapter: "The incident", title: "Someone adds a second uplink “for redundancy”.", body: <p>{SECONDARY_PORT} now also connects SW1 and SW2. No loop-prevention protocol (no STP) is running. Now there are <Bb>two paths</Bb> between the switches: a loop.</p> },
  { id: "loop", chapter: "The incident", title: "One broadcast becomes endless copies.", body: <p>A broadcast flooded by SW1 goes up <i>both</i> uplinks. Each copy arriving at SW2 on one uplink is flooded out the other, back to SW1, which floods it back again…</p> },
  { id: "no-ttl", chapter: "The incident", title: "Ethernet has no TTL. Nothing stops the copies.", body: <p>Routers decrement the IP TTL and drop a packet at 0. A switch forwards an Ethernet frame <Bb>unchanged</Bb> — there is no TTL, no hop count. The two copies circulate forever, and every new broadcast adds two more.</p> },
  { id: "storm", chapter: "The incident", title: "A third path makes it multiply: a broadcast storm.", body: <p>With three links between the switches, a copy arriving on one is flooded out the <i>two</i> others. The copies on the links double every hop: <Bb>3, 6, 12, 24…</Bb> Links and switch CPUs saturate within milliseconds.</p> },
  { id: "flap", chapter: "The incident", title: "MAC flapping: the table can't make up its mind.", body: <p>HOST-A&apos;s frames now arrive at SW2 on {PRIMARY_PORT}, then on {SECONDARY_PORT}, then {PRIMARY_PORT} again. Source learning keeps moving the entry: unicast to HOST-A goes the wrong way half the time.</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Symptoms everywhere, one cause.", body: <p>Everything is slow, link lights flash nonstop, switches log MAC moves. Follow the evidence to the loop.</p> },
  { id: "fix", chapter: "Troubleshooting", title: "Break the loop, then prove it's gone.", body: <p>Disable {SECONDARY_PORT} (it flushes the entries learned there). The circulating copies drain away; a new broadcast is flooded once; unicast follows stable entries again.</p> },
  { id: "stp", chapter: "What comes next", title: "Redundancy without loops needs STP.", body: <p>The <Bb>Spanning Tree Protocol</Bb> keeps the extra link but blocks it until it&apos;s needed. That&apos;s the next lesson in the Enterprise path.</p> },
  { id: "recap", chapter: "The whole idea", title: "Each switch learns alone; loops have no brakes.", body: <p>Now watch both tables fill frame by frame in the lesson, cause the loop, and fix it.</p> },
];

const VISUAL: Record<Id, string> = { why: "net", own: "net", "a-sends": "net", sw2: "net", filter: "net", reply: "net", tables: "tables", local: "net", bcast: "net", change: "net", redundant: "net", loop: "net", "no-ttl": "net", storm: "storm", flap: "net", trouble: "trouble", fix: "net", stp: "net", recap: "recap" };

const NODES: TopoNode[] = [
  { id: "a", label: "HOST-A", sub: sm(A), icon: "💻", x: 8, y: 22 },
  { id: "d", label: "HOST-D", sub: sm(D), icon: "💻", x: 8, y: 82 },
  { id: "sw1", label: "SW1", icon: "⇄", x: 33, y: 50 },
  { id: "sw2", label: "SW2", icon: "⇄", x: 67, y: 50 },
  { id: "b", label: "HOST-B", sub: sm(Bm), icon: "💻", x: 92, y: 22 },
  { id: "c", label: "HOST-C", sub: sm(SWF_MAC["HOST-C"]), icon: "💻", x: 92, y: 82 },
];
const at = (n: string) => nodeAt(NODES, n);
const MID2: [number, number] = [50, 78];

type Fdb = { sw1: [string, string, TableRow["state"]?][]; sw2: [string, string, TableRow["state"]?][] };
const FDB: Partial<Record<Id, Fdb>> = {
  own: { sw1: [], sw2: [] },
  "a-sends": { sw1: [[A, "ge-0/0/1", "new"]], sw2: [] },
  sw2: { sw1: [[A, "ge-0/0/1"]], sw2: [[A, PRIMARY_PORT, "new"]] },
  filter: { sw1: [[A, "ge-0/0/1"]], sw2: [[A, PRIMARY_PORT]] },
  reply: { sw1: [[A, "ge-0/0/1"], [Bm, PRIMARY_PORT, "new"]], sw2: [[A, PRIMARY_PORT], [Bm, "ge-0/0/1", "new"]] },
  local: { sw1: [[A, "ge-0/0/1", "hit"], [Bm, PRIMARY_PORT], [D, "ge-0/0/2", "new"]], sw2: [[A, PRIMARY_PORT], [Bm, "ge-0/0/1"]] },
  bcast: { sw1: [[A, "ge-0/0/1"], [Bm, PRIMARY_PORT], [D, "ge-0/0/2", "hit"]], sw2: [[A, PRIMARY_PORT], [Bm, "ge-0/0/1"], [D, PRIMARY_PORT, "new"]] },
  change: { sw1: [[A, "ge-0/0/1"], [Bm, PRIMARY_PORT]], sw2: [[A, PRIMARY_PORT], [Bm, "ge-0/0/1"], [D, `${PRIMARY_PORT} (stale)`, "bad"]] },
  flap: { sw1: [[A, "ge-0/0/1"], [Bm, PRIMARY_PORT], [D, "ge-0/0/2"]], sw2: [[A, `${PRIMARY_PORT} ⇄ ${SECONDARY_PORT}`, "bad"], [Bm, "ge-0/0/1"]] },
  fix: { sw1: [[A, "ge-0/0/1"], [Bm, PRIMARY_PORT], [D, "ge-0/0/2"]], sw2: [[A, PRIMARY_PORT, "new"], [Bm, "ge-0/0/1"]] },
};

function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const id = s.id;
  const k = `${id}-${play}`;
  const head = <StageHead chapter={s.chapter} title={s.title} />;
  const go = (f: string | [number, number], t: string | [number, number], o: { label: string; key: string; delay?: number; stay?: boolean; color?: string; d?: number }) => {
    const from = typeof f === "string" ? at(f) : f;
    const to = typeof t === "string" ? at(t) : t;
    return (
      <Mover key={`${k}-${o.key}`} from={from} to={o.stay ? short(from, to) : to} delay={o.delay} duration={o.d ?? 700} stay={o.stay}>
        <Token color={o.color ?? "cyan"}>{o.label}</Token>
      </Mover>
    );
  };
  const second = ["redundant", "loop", "no-ttl", "flap"].includes(id);
  const views: Record<string, TopoView> = {};
  let movers: ReactNode = null;
  const links = [
    { a: "a", b: "sw1", label: "ge-0/0/1" },
    { a: "d", b: "sw1", label: "ge-0/0/2" },
    { a: "sw1", b: "sw2", label: PRIMARY_PORT, state: second ? ("active" as const) : ("up" as const) },
    { a: "sw2", b: "b", label: "ge-0/0/1" },
    { a: "sw2", b: "c", label: "ge-0/0/2" },
  ];

  if (VISUAL[id] === "net") {
    if (id === "why") {
      views.sw1 = { bubble: { text: "floor 1", tone: "info" } };
      views.sw2 = { bubble: { text: "floor 2", tone: "info" } };
    }
    if (id === "own") {
      views.sw1 = { ring: "on", bubble: { text: "my table: empty", tone: "info" } };
      views.sw2 = { ring: "on", bubble: { text: "my table: empty", tone: "info" } };
    }
    if (id === "a-sends") {
      movers = (
        <>
          {go("a", "sw1", { label: "to B", key: "1" })}
          {go("sw1", "d", { label: "to B", key: "2", delay: 700, stay: true, color: "amber" })}
          {go("sw1", "sw2", { label: "to B", key: "3", delay: 700, stay: true, color: "amber" })}
        </>
      );
      views.sw1 = { ring: "on", bubble: { text: `learn ${sm(A)} → ge-0/0/1 · B? flood`, tone: "ask", delay: 500 } };
    }
    if (id === "sw2" || id === "filter") {
      movers = (
        <>
          {go("sw1", "sw2", { label: "to B", key: "1", color: "amber" })}
          {go("sw2", "b", { label: "to B", key: "2", delay: 700, stay: true, color: "amber" })}
          {go("sw2", "c", { label: "to B", key: "3", delay: 700, stay: true, color: "amber" })}
        </>
      );
      views.sw2 = { ring: "on", bubble: { text: `learn ${sm(A)} → ${PRIMARY_PORT} · B? flood`, tone: "ask", delay: 500 } };
      if (id === "filter") {
        views.b = { ring: "target", bubble: { text: "mine → accept", tone: "yes", delay: 1500 } };
        views.c = { ring: "hit", bubble: { text: "not mine → discard", tone: "no", delay: 1500 } };
        views.d = { ring: "hit", bubble: { text: "discarded earlier", tone: "no" } };
      }
    }
    if (id === "reply") {
      movers = (
        <>
          {go("b", "sw2", { label: "to A", key: "1", color: "green" })}
          {go("sw2", "sw1", { label: "to A", key: "2", delay: 700, color: "green" })}
          {go("sw1", "a", { label: "to A", key: "3", delay: 1400, stay: true, color: "green" })}
        </>
      );
      views.sw2 = { bubble: { text: "learn B · A known → uplink only", tone: "yes", delay: 500 } };
      views.sw1 = { bubble: { text: `learn B → ${PRIMARY_PORT} · A known`, tone: "yes", delay: 1200 } };
      views.c = { ring: "dim" };
      views.d = { ring: "dim" };
    }
    if (id === "local") {
      movers = (
        <>
          {go("d", "sw1", { label: "to A", key: "1" })}
          {go("sw1", "a", { label: "to A", key: "2", delay: 700, stay: true, color: "green" })}
        </>
      );
      views.sw2 = { ring: "dim", bubble: { text: "never sees it", tone: "no", delay: 700 } };
      views.b = { ring: "dim" };
      views.c = { ring: "dim" };
    }
    if (id === "bcast") {
      movers = (
        <>
          {go("d", "sw1", { label: "FF:FF…", key: "1" })}
          {go("sw1", "a", { label: "FF:FF…", key: "2", delay: 700, stay: true, color: "amber" })}
          {go("sw1", "sw2", { label: "FF:FF…", key: "3", delay: 700, color: "amber" })}
          {go("sw2", "b", { label: "FF:FF…", key: "4", delay: 1400, stay: true, color: "amber" })}
          {go("sw2", "c", { label: "FF:FF…", key: "5", delay: 1400, stay: true, color: "amber" })}
        </>
      );
    }
    if (id === "loop" || id === "no-ttl") {
      const waves = [0, 1, 2];
      movers = (
        <>
          {go("a", "sw1", { label: "FF:FF…", key: "start", d: 600 })}
          {waves.map((w) => (
            <span key={w}>
              {go("sw1", "sw2", { label: `lap ${w + 1}`, key: `p${w}`, delay: 600 + w * 1800, d: 900, color: "red" })}
              {go("sw2", MID2, { label: `lap ${w + 1}`, key: `s${w}a`, delay: 1500 + w * 1800, d: 450, color: "red" })}
              {go(MID2, "sw1", { label: `lap ${w + 1}`, key: `s${w}b`, delay: 1950 + w * 1800, d: 450, color: "red" })}
            </span>
          ))}
        </>
      );
      views.sw1 = { ring: "bad", bubble: { text: "flood · flood · flood…", tone: "bad", delay: 1800 } };
      views.sw2 = { ring: "bad", bubble: { text: id === "no-ttl" ? "no TTL field: never dies" : "in on one uplink → out the other", tone: "bad", delay: 1200 } };
    }
    if (id === "change") {
      views.d = { ring: "dim", bubble: { text: "moved to SW2 ge-0/0/3", tone: "warn" } };
      views.sw1 = { bubble: { text: "ge-0/0/2 down → D flushed", tone: "info" } };
      views.sw2 = { ring: "bad", bubble: { text: `D → ${PRIMARY_PORT}? stale!`, tone: "bad", delay: 500 } };
    }
    if (id === "redundant") views.sw2 = { ring: "hit", bubble: { text: "two paths, no STP", tone: "warn" } };
    if (id === "flap") views.sw2 = { ring: "bad", bubble: { text: `A on ${PRIMARY_PORT}… no, ${SECONDARY_PORT}… no…`, tone: "bad" } };
    if (id === "fix") {
      movers = (
        <>
          {go("a", "sw1", { label: "FF:FF…", key: "1" })}
          {go("sw1", "sw2", { label: "FF:FF… once", key: "2", delay: 700, color: "amber" })}
          {go("sw2", "b", { label: "FF:FF…", key: "3", delay: 1400, stay: true, color: "amber" })}
          {go("sw2", "c", { label: "FF:FF…", key: "4", delay: 1400, stay: true, color: "amber" })}
        </>
      );
      views.sw1 = { ring: "on", bubble: { text: `${SECONDARY_PORT} disabled`, tone: "yes" } };
    }
    if (id === "stp") {
      views.sw2 = { ring: "on", bubble: { text: `${SECONDARY_PORT}: blocked by STP (standby)`, tone: "warn" } };
    }
    const fdb = FDB[id];
    return (
      <>
        {head}
        <Topo nodes={NODES} links={links} views={views} ratio={42} minH={230}>
          {(second || id === "stp") && (
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
              <path d="M33 50 Q50 92 67 50" fill="none" stroke={id === "stp" ? "#a78bfa" : "#f87171"} strokeWidth={id === "stp" ? 2 : 3} strokeDasharray={id === "stp" ? "6 4" : undefined} vectorEffect="non-scaling-stroke" />
            </svg>
          )}
          {(second || id === "stp") && (
            <span className="absolute z-10 -translate-x-1/2 rounded bg-pv-bg/90 px-1 pv-mono text-[10px] text-pv-danger sm:text-[11px]" style={{ left: "50%", top: "73%" }}>
              {SECONDARY_PORT}
            </span>
          )}
          {movers}
        </Topo>
        {fdb && (
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniTable title="SW1 MAC table" cols={["MAC", "Port"]} rows={fdb.sw1.map(([m, p, st]) => ({ cells: [sm(m), p], state: st }))} />
            <MiniTable title="SW2 MAC table" cols={["MAC", "Port"]} rows={fdb.sw2.map(([m, p, st]) => ({ cells: [sm(m), p], state: st, note: st === "bad" ? (id === "flap" ? "flapping: moves with every copy" : "stale: HOST-D has moved") : undefined }))} />
          </div>
        )}
        {!["why", "own", "redundant", "flap", "stp"].includes(id) && <ReplayButton onClick={replay} />}
      </>
    );
  }

  switch (id) {
    case "tables":
      return (
        <>
          {head}
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniTable title="SW1 MAC table" cols={["MAC", "Port"]} rows={[{ cells: ["HOST-A", "ge-0/0/1 (access)"] }, { cells: ["HOST-B", `${PRIMARY_PORT} (uplink)`], state: "hit" }]} />
            <MiniTable title="SW2 MAC table" cols={["MAC", "Port"]} rows={[{ cells: ["HOST-A", `${PRIMARY_PORT} (uplink)`], state: "hit" }, { cells: ["HOST-B", "ge-0/0/1 (access)"] }]} />
          </div>
          <Compare items={[{ title: "Same frame, two decisions", tone: "cyan", body: "SW1 and SW2 each look up the destination in their own table" }, { title: "The uplink port", tone: "violet", body: "every MAC on the far switch is learned behind it" }]} />
        </>
      );
    case "storm":
      return (
        <>
          {head}
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniTable title="Two links: copies per hop" cols={["Hop", "Copies on the links"]} rows={[1, 2, 3, 4, 5].map((h) => ({ cells: [String(h), "2"] }))} />
            <MiniTable title="Three links: copies per hop" cols={["Hop", "Copies on the links"]} rows={[3, 6, 12, 24, 48].map((n, i) => ({ cells: [String(i + 1), String(n)], state: i > 1 ? ("bad" as const) : undefined }))} />
          </div>
          <Compare items={[{ title: "Two paths", tone: "amber", body: "each broadcast leaves two copies that never die" }, { title: "Three or more", tone: "red", body: "every hop multiplies them — a storm in milliseconds" }]} />
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain
            k="ts"
            items={[
              { t: "Symptom: whole LAN slow/unreachable right after a change", tone: "red" },
              { t: "Observe: link LEDs blinking nonstop, CPU high", tone: "plain" },
              { t: "Evidence: MAC-move/flap messages for many MACs", tone: "amber" },
              { t: `Evidence: two active links SW1↔SW2 (${PRIMARY_PORT}, ${SECONDARY_PORT})`, tone: "amber" },
              { t: "Hypothesis: Layer-2 loop, no STP", tone: "violet" },
              { t: `Repair: disable ${SECONDARY_PORT} (or run STP)`, tone: "green" },
              { t: "Verify: storm drains, one copy per broadcast, stable table", tone: "green" },
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
              { t: "Each switch has its own table, learned from its own ports" },
              { t: "Remote MACs are learned behind the uplink", tone: "cyan" },
              { t: "Every switch does its own lookup: forward or flood", tone: "plain" },
              { t: "Local traffic stays local; broadcast crosses all", tone: "violet" },
              { t: "Two paths + no STP = a loop", tone: "red" },
              { t: "Entries age, flush and go stale when a host moves", tone: "amber" },
              { t: "No TTL in Ethernet → endless copies, a storm with more paths, MAC flapping", tone: "red" },
              { t: "Break the loop, verify; STP does it automatically", tone: "green" },
            ]}
          />
        </>
      );
  }
  return head;
}

export function SwitchingPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="Multi-switch forwarding, from zero"
      kicker="Learn · the Switching presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id]}
      renderStage={(s) => <Deck step={s} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
