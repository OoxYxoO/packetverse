"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, PacketCard, Pills, ReplayButton, Stat, Token, Topo, nodeAt, short, type TableRow, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { BROADCAST_MAC, ETH_MAC, FDB_AGING_SEC } from "@/lib/sim-engine/scenarios/ethernetSwitching";

/**
 * ETHERNET SWITCHING — the presentation before the lesson/lab. Same LAN as the guided lesson (SW1, HOST-A/B/C,
 * the unmanaged DESK-SW hot desk on ge-0/0/4) and the same incident (a stale MAC-table entry), so everything the
 * learner sees here reappears in the lesson. Presentation state only: no engine, no progress.
 */

const A = ETH_MAC["HOST-A"];
const Bm = ETH_MAC["HOST-B"];
const C = ETH_MAC["HOST-C"];
const sm = (m: string) => `…${m.slice(-5)}`;

type Id =
  | "why" | "hub" | "mac" | "frame" | "filter" | "empty" | "learn" | "flood" | "reply" | "known" | "bcast" | "bcast-vs" | "aging"
  | "move" | "relearn" | "incident" | "lost" | "trouble" | "fix" | "router" | "recap";
type Step = DeckStep & { id: Id };
const Bb = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;

const STEPS: Step[] = [
  { id: "why", chapter: "Why switches exist", title: "Several computers, one LAN. Who is each frame for?", body: <p>HOST-A, HOST-B and HOST-C share a LAN. When HOST-A sends something to HOST-B, the network needs a way to say <Bb>who the frame is for</Bb>, and a device that delivers it there.</p> },
  { id: "hub", chapter: "Why switches exist", title: "A hub repeats everything. A switch delivers.", body: <p>Toggle between them. A <Bb>hub</Bb> copies every frame to every port: everyone hears everything. A <Bb>switch</Bb> learns where each device lives and sends the frame only toward it.</p> },
  { id: "mac", chapter: "MAC addresses", title: "Every network card has a MAC address.", body: <p>A MAC address is 48 bits, written as six hex bytes. It names one network interface on the LAN. HOST-A is <Bb>{A}</Bb>.</p> },
  { id: "frame", chapter: "The Ethernet frame", title: "The frame carries two MACs: to and from.", body: <p>Destination MAC first (so receivers can decide quickly), then source MAC, the EtherType (what&apos;s inside), the payload, and an FCS checksum to detect damage.</p> },
  { id: "filter", chapter: "The Ethernet frame", title: "Hosts keep only frames addressed to them.", body: <p>A network card accepts a frame when the destination is <Bb>its own MAC or broadcast</Bb>. Anything else is quietly discarded. Remember this when frames get flooded.</p> },
  { id: "empty", chapter: "Inside the switch", title: "A new switch knows nothing.", body: <p>SW1&apos;s <Bb>MAC address table</Bb> (FDB) maps MAC → port. At power-up it&apos;s empty. Cables and link lights teach it nothing. Only frames do.</p> },
  { id: "learn", chapter: "Learn the source", title: "HOST-A sends to HOST-B. SW1 learns the SOURCE.", body: <p>The frame arrives on ge-0/0/1. SW1 notes: <Bb>{A} lives behind ge-0/0/1</Bb>. It learns from the source MAC, never from the destination.</p> },
  { id: "flood", chapter: "Unknown unicast", title: "Destination unknown → flood it.", body: <p>SW1 has no entry for {Bm}. Rather than drop it, it sends a copy out <Bb>every other port</Bb> (never back out ge-0/0/1), frame unchanged. HOST-B accepts it; HOST-C discards it; DESK-SW has nobody behind it.</p> },
  { id: "reply", chapter: "Known unicast", title: "HOST-B replies. Now SW1 learns HOST-B.", body: <p>The reply arrives on ge-0/0/2: <Bb>{Bm} → ge-0/0/2</Bb>. HOST-A is already known, so the reply leaves on <Bb>one port only</Bb>.</p> },
  { id: "known", chapter: "Known unicast", title: "From now on, A ↔ B is private.", body: <p>Both MACs are in the table. Frames between them use exactly one egress port each way. No flooding, no one else disturbed.</p> },
  { id: "bcast", chapter: "Broadcast", title: "A broadcast goes to everyone, on purpose.", body: <p>HOST-C sends to <Bb>{BROADCAST_MAC}</Bb> (for example an ARP request). The table doesn&apos;t matter: a broadcast is addressed to all, so SW1 floods it. SW1 still learns HOST-C from the source.</p> },
  { id: "bcast-vs", chapter: "Broadcast", title: "Two floods, two different reasons.", body: <p><Bb>Unknown unicast</Bb> is flooded because the switch doesn&apos;t know the port yet; it stops once the destination speaks. <Bb>Broadcast</Bb> is flooded because it&apos;s meant for everyone; that never stops.</p> },
  { id: "aging", chapter: "Time", title: "Entries expire if a device goes quiet.", body: <p>Each dynamic entry is refreshed whenever that MAC sends. If it stays silent past the aging time (IEEE 802.1D recommends {FDB_AGING_SEC} s; it&apos;s configurable), the entry is removed and the next frame to it is flooded again.</p> },
  { id: "move", chapter: "Hosts move", title: "HOST-B moves to the hot desk.", body: <p>HOST-B is unplugged from ge-0/0/2 and plugged into DESK-SW. ge-0/0/2 goes <Bb>down</Bb>, so SW1 flushes what it learned there. But it has no idea where HOST-B went.</p> },
  { id: "relearn", chapter: "Hosts move", title: "SW1 finds HOST-B only when HOST-B speaks.", body: <p>HOST-B sends a frame. DESK-SW learns it on port 2; SW1 learns <Bb>{Bm} → ge-0/0/4</Bb>. The move is known because a frame arrived, not because a cable moved.</p> },
  { id: "incident", chapter: "The incident", title: "Ticket: “HOST-A can't reach HOST-B.” Every link light is on.", body: <p>HOST-B&apos;s user went back to the old desk: HOST-B is on ge-0/0/2 again. But <Bb>ge-0/0/4 never went down</Bb>, so the old entry was never flushed, and HOST-B hasn&apos;t sent anything yet.</p> },
  { id: "lost", chapter: "The incident", title: "SW1 forwards perfectly, to the wrong place.", body: <p>The table says HOST-B is behind ge-0/0/4, so the frame goes to DESK-SW. DESK-SW forgot HOST-B when its port 2 went dark. With no entry it would flood the frame — but it has no other live port. HOST-B never sees it. <Bb>No device reports an error.</Bb></p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Follow the evidence, not the link lights.", body: <p>Symptom → look at the MAC table → compare it with where the host really is → the entry is <Bb>stale</Bb>.</p> },
  { id: "fix", chapter: "Troubleshooting", title: "Fix it, then prove it.", body: <p>Clear the stale entry (or let HOST-B send any frame). The next frame to HOST-B floods, HOST-B replies from ge-0/0/2, SW1 relearns it there, and traffic is known unicast again.</p> },
  { id: "router", chapter: "Switch vs router", title: "A switch never changes the frame.", body: <p>A switch forwards by <Bb>MAC</Bb> inside one LAN and leaves the frame untouched. Reaching another network needs a <Bb>router</Bb>, which forwards by IP and builds a new frame. That&apos;s the next lessons.</p> },
  { id: "recap", chapter: "The whole idea", title: "Learn the source. Look up the destination.", body: <p>Now watch SW1 do it in the lesson, frame by frame. In the Ethernet Lab you predict each decision on SW1&apos;s ports, then work on the switch yourself: its console, its captures, and real tickets to fix.</p> },
];

const VISUAL: Record<Id, string> = {
  why: "lan", hub: "lan", mac: "frame", frame: "frame", filter: "lan", empty: "lan", learn: "lan", flood: "lan", reply: "lan", known: "lan", bcast: "lan",
  "bcast-vs": "vs", aging: "aging", move: "lan", relearn: "lan", incident: "lan", lost: "lan", trouble: "trouble", fix: "lan", router: "router", recap: "recap",
};

// ---------------------------------------------------------------------------------------------------------------
// The LAN
// ---------------------------------------------------------------------------------------------------------------
const NODES = (bOnDesk: boolean): TopoNode[] => [
  { id: "a", label: "HOST-A", sub: sm(A), sub2: A, icon: "💻", x: 11, y: 22 },
  { id: "c", label: "HOST-C", sub: sm(C), sub2: C, icon: "💻", x: 11, y: 82 },
  { id: "sw", label: "SW1", sub: "switch", icon: "⇄", x: 44, y: 52 },
  { id: "b", label: "HOST-B", sub: sm(Bm), sub2: Bm, icon: "💻", x: bOnDesk ? 92 : 82, y: bOnDesk ? 82 : 18 },
  { id: "desk", label: "DESK-SW", sub: "hot desk", icon: "⇄", x: 70, y: 82 },
];
const LINKS = (bOnDesk: boolean): TopoLink[] => [
  { a: "sw", b: "a", label: "ge-0/0/1" },
  { a: "sw", b: "c", label: "ge-0/0/3", at: 0.36 },
  { a: "sw", b: "b", label: bOnDesk ? undefined : "ge-0/0/2", state: bOnDesk ? "dim" : "up" },
  { a: "sw", b: "desk", label: "ge-0/0/4", at: 0.36 },
  ...(bOnDesk ? [{ a: "desk", b: "b", label: "port 2" } as TopoLink] : []),
];

type Fdb = [string, string, TableRow["state"]?][];
const FDB: Partial<Record<Id, Fdb>> = {
  empty: [],
  learn: [[A, "ge-0/0/1", "new"]],
  flood: [[A, "ge-0/0/1"]],
  reply: [[A, "ge-0/0/1"], [Bm, "ge-0/0/2", "new"]],
  known: [[A, "ge-0/0/1", "hit"], [Bm, "ge-0/0/2", "hit"]],
  bcast: [[A, "ge-0/0/1"], [Bm, "ge-0/0/2"], [C, "ge-0/0/3", "new"]],
  move: [[A, "ge-0/0/1"], [Bm, "ge-0/0/2", "bad"], [C, "ge-0/0/3"]],
  relearn: [[A, "ge-0/0/1"], [C, "ge-0/0/3"], [Bm, "ge-0/0/4", "new"]],
  incident: [[A, "ge-0/0/1"], [C, "ge-0/0/3"], [Bm, "ge-0/0/4", "bad"]],
  lost: [[A, "ge-0/0/1"], [C, "ge-0/0/3"], [Bm, "ge-0/0/4", "bad"]],
  fix: [[A, "ge-0/0/1"], [C, "ge-0/0/3"], [Bm, "ge-0/0/2", "new"]],
};

function EthernetDeck({ step: s, play, replay, hub, setHub }: { step: Step; play: number; replay: () => void; hub: boolean; setHub: (v: boolean) => void }) {
  const id = s.id;
  const k = `${id}-${play}-${hub}`;
  const head = <StageHead chapter={s.chapter} title={s.title} />;
  const bOnDesk = ["move", "relearn"].includes(id);
  const nodes = NODES(bOnDesk);
  const at = (n: string) => nodeAt(nodes, n);
  const go = (from: string, to: string, opts: { delay?: number; stay?: boolean; color?: string; label: string; key: string; d?: number }) => (
    <Mover key={`${k}-${opts.key}`} from={at(from)} to={opts.stay ? short(at(from), at(to)) : at(to)} delay={opts.delay} duration={opts.d ?? 850} stay={opts.stay}>
      <Token color={opts.color ?? "cyan"}>{opts.label}</Token>
    </Mover>
  );

  if (VISUAL[id] === "lan") {
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    let links = LINKS(bOnDesk);
    const fdb = FDB[id];
    if (id === "why") {
      views.a = { ring: "on", bubble: { text: "for HOST-B…", tone: "info" } };
      views.b = { ring: "target" };
    }
    if (id === "hub") {
      views.sw = { badge: { text: hub ? "HUB" : "SWITCH", tone: hub ? "bad" : "yes" } };
      movers = (
        <>
          {go("a", "sw", { label: "to B", key: "1", d: 700 })}
          {(hub ? ["b", "c", "desk"] : ["b"]).map((n) => go("sw", n, { label: "to B", key: `2${n}`, delay: 700, stay: true }))}
        </>
      );
      views.b = { ring: "target", bubble: { text: "for me ✓", tone: "yes", delay: 1500 } };
      if (hub) {
        views.c = { ring: "hit", bubble: { text: "heard it — not mine", tone: "no", delay: 1500 } };
        views.desk = { ring: "hit" };
      }
    }
    if (id === "filter") {
      movers = (
        <>
          {go("a", "sw", { label: `to ${sm(Bm)}`, key: "0", d: 700 })}
          {(["b", "c"] as const).map((n) => go("sw", n, { label: `to ${sm(Bm)}`, key: n, delay: 700, stay: true }))}
        </>
      );
      views.a = { ring: "on" };
      views.b = { ring: "target", bubble: { text: "dst = my MAC → accept", tone: "yes", delay: 1600 } };
      views.c = { ring: "hit", bubble: { text: "not my MAC → discard", tone: "no", delay: 1600 } };
      links = links.map((l) => (l.b === "desk" ? { ...l, state: "dim" } : l));
    }
    if (id === "empty") views.sw = { ring: "on", bubble: { text: "MAC table: empty", tone: "info" } };
    if (id === "learn") {
      movers = go("a", "sw", { label: `src ${sm(A)}`, key: "1", stay: true });
      views.sw = { ring: "on", bubble: { text: `learn ${sm(A)} → ge-0/0/1`, tone: "yes", delay: 900 } };
      views.a = { ring: "on" };
    }
    if (id === "flood") {
      movers = (
        <>
          {go("a", "sw", { label: "to B", key: "1", d: 700 })}
          {(["b", "c", "desk"] as const).map((n) => go("sw", n, { label: "to B", key: n, delay: 700, stay: true, color: "amber" }))}
        </>
      );
      views.sw = { ring: "hit", bubble: { text: "B unknown → flood", tone: "ask", delay: 600 } };
      views.b = { ring: "target", bubble: { text: "mine → accept", tone: "yes", delay: 1600 } };
      views.c = { ring: "hit", bubble: { text: "not mine → discard", tone: "no", delay: 1600 } };
      views.desk = { ring: "hit", bubble: { text: "no one behind me", tone: "no", delay: 1600 } };
      links = links.map((l) => (l.b === "a" ? { ...l, state: "active" } : l));
    }
    if (id === "reply") {
      movers = (
        <>
          {go("b", "sw", { label: "to A", key: "1", d: 750 })}
          {go("sw", "a", { label: "to A", key: "2", delay: 750, stay: true, color: "green" })}
        </>
      );
      views.sw = { ring: "on", bubble: { text: `learn ${sm(Bm)} → ge-0/0/2 · A known → 1 port`, tone: "yes", delay: 600 } };
      views.c = { ring: "dim" };
      views.desk = { ring: "dim" };
    }
    if (id === "known") {
      movers = (
        <>
          {go("a", "sw", { label: "to B", key: "1", d: 700 })}
          {go("sw", "b", { label: "to B", key: "2", delay: 700, stay: true, color: "green" })}
        </>
      );
      views.c = { ring: "dim" };
      views.desk = { ring: "dim" };
      views.sw = { ring: "on", bubble: { text: "known → ge-0/0/2 only", tone: "yes", delay: 600 } };
    }
    if (id === "bcast") {
      movers = (
        <>
          {go("c", "sw", { label: "FF:FF…", key: "1", d: 700 })}
          {(["a", "b", "desk"] as const).map((n) => go("sw", n, { label: "FF:FF…", key: n, delay: 700, stay: true, color: "amber" }))}
        </>
      );
      views.sw = { ring: "hit", bubble: { text: "broadcast → flood (always)", tone: "ask", delay: 600 } };
      views.a = { ring: "target", bubble: { text: "broadcast → accept", tone: "yes", delay: 1600 } };
      views.b = { ring: "target", bubble: { text: "broadcast → accept", tone: "yes", delay: 1600 } };
    }
    if (id === "move") {
      views.sw = { ring: "hit", bubble: { text: "ge-0/0/2 down → flush its entries", tone: "ask" } };
      views.b = { ring: "on", bubble: { text: "moved, silent so far", tone: "info" } };
    }
    if (id === "relearn") {
      movers = (
        <>
          {go("b", "desk", { label: `src ${sm(Bm)}`, key: "1", d: 700 })}
          {go("desk", "sw", { label: `src ${sm(Bm)}`, key: "2", delay: 700, d: 700 })}
          {go("sw", "a", { label: "to A", key: "3", delay: 1400, stay: true, color: "green" })}
        </>
      );
      views.desk = { ring: "on", bubble: { text: "learn B → port 2", tone: "yes", delay: 600 } };
      views.sw = { ring: "on", bubble: { text: "learn B → ge-0/0/4", tone: "yes", delay: 1300 } };
    }
    if (id === "incident") {
      views.b = { ring: "on", bubble: { text: "back on ge-0/0/2 · silent", tone: "info" } };
      views.sw = { ring: "hit", bubble: { text: "table still: B → ge-0/0/4", tone: "bad" } };
    }
    if (id === "lost") {
      movers = (
        <>
          {go("a", "sw", { label: "to B", key: "1", d: 700 })}
          {go("sw", "desk", { label: "to B", key: "2", delay: 700, stay: true, color: "red" })}
        </>
      );
      views.sw = { ring: "hit", bubble: { text: "known → ge-0/0/4", tone: "info", delay: 600 } };
      views.desk = { ring: "bad", bubble: { text: "B? nobody here → lost", tone: "bad", delay: 1600 } };
      views.b = { ring: "dim", bubble: { text: "never sees it", tone: "no", delay: 1600 } };
      links = links.map((l) => (l.b === "desk" ? { ...l, state: "active" } : l));
    }
    if (id === "fix") {
      movers = (
        <>
          {go("a", "sw", { label: "to B", key: "1", d: 650 })}
          {(["b", "c", "desk"] as const).map((n) => go("sw", n, { label: "to B", key: n, delay: 650, d: 700, color: "amber" }))}
          {go("b", "sw", { label: "to A", key: "r1", delay: 1700, d: 650 })}
          {go("sw", "a", { label: "to A", key: "r2", delay: 2350, stay: true, color: "green" })}
        </>
      );
      views.sw = { ring: "on", bubble: { text: "stale entry cleared → flood → relearn ge-0/0/2", tone: "yes", delay: 2300 } };
      views.b = { ring: "target", bubble: { text: "replies", tone: "yes", delay: 1600 } };
    }

    const animated = ["hub", "filter", "learn", "flood", "reply", "known", "bcast", "relearn", "lost", "fix"].includes(id);
    return (
      <>
        {head}
        {id === "hub" && <Pills label="Device in the middle" options={[{ v: "hub", label: "Hub" }, { v: "switch", label: "Switch" }]} value={hub ? "hub" : "switch"} onPick={(v) => setHub(v === "hub")} />}
        <Topo nodes={nodes} links={links} views={views} showSub2={["learn", "reply", "known"].includes(id)}>
          {movers}
        </Topo>
        {fdb && <MiniTable title="SW1 MAC address table" cols={["MAC", "Port"]} rows={fdb.map(([m, p, st]) => ({ cells: [m, p], state: st, note: st === "bad" && id === "move" ? "flushed: its port went down" : st === "bad" ? "stale: HOST-B is really on ge-0/0/2" : undefined }))} />}
        {animated && <ReplayButton onClick={replay} />}
      </>
    );
  }

  switch (id) {
    case "mac":
    case "frame":
      return (
        <>
          {head}
          {id === "mac" ? (
            <div className="mx-auto w-full max-w-lg space-y-2 text-center">
              <p className="pv-mono text-[26px] font-bold text-pv-text sm:text-[36px]">{A}</p>
              <div className="grid grid-cols-2 gap-2">
                <Stat k="first 3 bytes (OUI)" v="00:11:22" tone="violet" sub="usually the manufacturer" />
                <Stat k="last 3 bytes" v="33:44:0A" tone="cyan" sub="this particular card" />
              </div>
              <p className="text-[14px] text-pv-text-muted">48 bits · burned into the network interface (it can be changed in software) · unique on the LAN</p>
            </div>
          ) : (
            <PacketCard
              layers={[
                {
                  name: "Ethernet II frame",
                  color: "#94a3b8",
                  fields: [
                    { k: "Destination MAC", v: Bm, hi: "key" },
                    { k: "Source MAC", v: A, hi: "key" },
                    { k: "EtherType", v: "0x0800 (IPv4)" },
                    { k: "Payload", v: "the IP packet" },
                    { k: "FCS", v: "CRC-32 check" },
                  ],
                },
              ]}
            />
          )}
        </>
      );
    case "bcast-vs":
      return (
        <>
          {head}
          <Compare
            items={[
              { title: "Unknown unicast", tone: "amber", body: <>dst = one specific MAC the switch hasn&apos;t learned yet<br /><b className="text-pv-text">flooded until that host speaks</b>; then known unicast</> },
              { title: "Broadcast", tone: "violet", body: <>dst = {BROADCAST_MAC}<br /><b className="text-pv-text">always flooded</b>: meant for every host on the LAN</> },
            ]}
          />
          <Compare
            items={[
              { title: "Who keeps a flooded unicast?", tone: "plain", body: "only the host whose MAC matches; the others discard it" },
              { title: "Who keeps a broadcast?", tone: "plain", body: "every host on the LAN processes it" },
            ]}
          />
        </>
      );
    case "aging":
      return (
        <>
          {head}
          <div className="mx-auto w-full max-w-md rounded-2xl border border-pv-border bg-pv-bg/70 p-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-pv-text-faint">SW1 entry</p>
            <p className="pv-mono text-[16px] font-bold text-pv-text sm:text-[19px]">{C} → ge-0/0/3</p>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-pv-border">
              <div className="pv-bar h-full rounded-full bg-gradient-to-r from-pv-success to-pv-warning" style={{ width: "40%" }} />
            </div>
            <div className="mt-1 flex justify-between text-[11.5px] text-pv-text-muted">
              <span>HOST-C sent a frame</span>
              <span>silent…</span>
              <span>aged out</span>
            </div>
          </div>
          <Chain k="age" items={[{ t: "HOST-C sources a frame → entry refreshed", tone: "green" }, { t: `Silent longer than the aging time (default ${FDB_AGING_SEC} s)`, tone: "amber" }, { t: "Entry removed", tone: "red" }, { t: "Next frame to HOST-C → flooded, then relearned", tone: "cyan" }]} />
          <p className="text-center text-[13px] text-pv-text-muted">Also: when a port goes down, the switch flushes the dynamic entries learned on that port.</p>
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain
            k="ts"
            items={[
              { t: "Symptom: HOST-A → HOST-B fails; all links up, no errors", tone: "red" },
              { t: "Observe: show mac address-table on SW1", tone: "plain" },
              { t: `Evidence: ${sm(Bm)} → ge-0/0/4 (DESK-SW)`, tone: "amber" },
              { t: "Reality: HOST-B is cabled to ge-0/0/2", tone: "amber" },
              { t: "Hypothesis: a stale dynamic entry", tone: "violet" },
              { t: "Root cause: ge-0/0/4 stayed up, so nothing flushed it, and HOST-B hasn't sent since moving", tone: "violet" },
            ]}
          />
          <MiniTable title="SW1 MAC address table (evidence)" cols={["MAC", "Port"]} rows={[{ cells: [A, "ge-0/0/1"] }, { cells: [C, "ge-0/0/3"] }, { cells: [Bm, "ge-0/0/4"], state: "bad", note: "doesn't match the cabling" }]} />
        </>
      );
    case "router":
      return (
        <>
          {head}
          <Compare
            items={[
              { title: "Switch · Layer 2", tone: "cyan", body: <>forwards by <b className="text-pv-text">destination MAC</b> within one LAN<br />learns from source MACs<br />frame leaves <b className="text-pv-text">unchanged</b></> },
              { title: "Router · Layer 3", tone: "violet", body: <>forwards by <b className="text-pv-text">destination IP</b> between networks<br />uses a routing table<br />builds a <b className="text-pv-text">new frame</b> for each hop</> },
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
              { t: "Frame arrives on a port" },
              { t: "Learn: source MAC → that port", tone: "green" },
              { t: "Look up the destination MAC" },
              { t: "Known → send out that one port", tone: "cyan" },
              { t: "Unknown → flood (not back out the ingress port)", tone: "amber" },
              { t: "Broadcast → flood, always", tone: "violet" },
              { t: "Entries age out · port down flushes them" },
              { t: "Stale entry → forwarded to the wrong place, silently", tone: "red" },
            ]}
          />
        </>
      );
  }
  return head;
}

export function EthernetPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  const [hub, setHub] = useState(true);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="Ethernet switching, from zero"
      kicker="Learn · the Ethernet presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id]}
      renderStage={(s) => <EthernetDeck step={s} play={play} replay={() => setPlay((p) => p + 1)} hub={hub} setHub={setHub} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
