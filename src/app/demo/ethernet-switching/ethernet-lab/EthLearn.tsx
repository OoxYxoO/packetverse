"use client";

import { clsx } from "clsx";
import type { ReactNode } from "react";
import type { CliVendor } from "@/lib/cli/types";
import { BROADCAST_MAC, ETH_MAC, FDB_AGING_SEC } from "@/lib/sim-engine/scenarios/ethernetSwitching";
import type { EthLabAction, EthLabState } from "@/lib/sim-engine/scenarios/ethernetLab";
import { Faceplate, FrameCard, MacTable, NicVerdicts, SwitchMind } from "./EthVisuals";
import { ethPortName, ethVendorText } from "./ethLabCli";

/**
 * Learn the switch: four levels, one idea at a time, always on the real network. Each step can rebuild the network it
 * starts from (so the order of visits never leaves stale state), plays its traffic on the topology, and shows only the
 * evidence the idea needs: the frame, then what each NIC did, then the switch's own reasoning and table, then time,
 * then a second switch. Prediction is done by clicking SW1's ports, and the switch's reasoning answers it.
 */

export type EthLevel = 1 | 2 | 3 | 4;
export interface LStep {
  id: string;
  title: string;
  body: (vendor: CliVendor) => ReactNode;
  /** Instant: the network this step starts from. */
  setup?: EthLabAction[];
  /** Animated traffic the student starts. */
  run?: { label: string; actions: EthLabAction[] };
  /** Predict SW1's egress ports for the last frame of `run`. */
  predict?: string;
  show: { frame?: boolean; nic?: boolean; mind?: boolean; desk?: boolean; table?: boolean; deskTable?: boolean; ports?: boolean; clock?: boolean; events?: number };
  /** Topology port labels from this step on. */
  portsOnMap?: boolean;
}
const send = (src: "HOST-A" | "HOST-B" | "HOST-C", dst: "HOST-A" | "HOST-B" | "HOST-C" | "broadcast"): EthLabAction => ({ type: "send", src, dst });
const FRESH: EthLabAction = { type: "fresh" };
const B = (x: ReactNode) => <b className="text-pv-text">{x}</b>;
const M = (x: ReactNode) => <span className="pv-mono text-pv-text">{x}</span>;

export const LEVELS: { level: EthLevel; title: string; idea: string }[] = [
  { level: 1, title: "One frame", idea: "What a frame carries, and how a network card decides it's for it" },
  { level: 2, title: "Inside the switch", idea: "Learn the source, look up the destination: flood or forward" },
  { level: 3, title: "Broadcast and time", idea: "Floods on purpose, and knowledge that expires" },
  { level: 4, title: "Two switches, a moving host", idea: "Each switch has its own table, and a table can be wrong" },
];

export const LEVEL_STEPS: Record<EthLevel, LStep[]> = {
  1: [
    {
      id: "l1-frame",
      title: "On a LAN, data travels in frames",
      body: () => (
        <>
          <p>HOST-A, HOST-B and HOST-C are on one LAN, wired to the switch SW1. Whatever they send to each other travels as an {B("Ethernet frame")}: an envelope that carries the data and, in front, two addresses.</p>
          <p>Every network card (NIC) has a {B("MAC address")}, burned in at the factory: six bytes like {M(ETH_MAC["HOST-A"])}. The frame says who it is {B("for")} (the destination MAC) and who it is {B("from")} (the source MAC).</p>
        </>
      ),
      setup: [FRESH],
      run: { label: "HOST-A sends a frame to HOST-B", actions: [send("HOST-A", "HOST-B")] },
      show: { frame: true },
    },
    {
      id: "l1-nic",
      title: "Every network card checks the destination",
      body: () => (
        <>
          <p>Look at what each card did with that frame. HOST-B {B("kept it")}: the destination MAC is its own. HOST-C also {B("received a copy")} — and threw it away, because the destination isn&apos;t its MAC.</p>
          <p>That check is the NIC&apos;s whole job: {B("destination = my MAC, or the broadcast address? keep it. Anything else? discard it.")} It never looks further into the frame.</p>
        </>
      ),
      show: { frame: true, nic: true },
    },
    {
      id: "l1-why",
      title: "So why did HOST-C get a copy at all?",
      body: () => (
        <>
          <p>HOST-C&apos;s card had to throw away a frame that was never meant for it. Something sent it there. That something is SW1, and it had a reason: when that frame arrived, {B("SW1 didn't know where HOST-B was")}.</p>
          <p>Send it again and compare: who gets a copy now?</p>
        </>
      ),
      run: { label: "HOST-B answers, then HOST-A sends to HOST-B again", actions: [send("HOST-B", "HOST-A"), send("HOST-A", "HOST-B")] },
      show: { frame: true, nic: true },
    },
    {
      id: "l1-sum",
      title: "The second time, only HOST-B got it",
      body: () => (
        <>
          <p>Same frame, same switch — but this time HOST-C received nothing. Between the two, SW1 {B("learned")} something. What it learned, and from where, is what the next level opens up.</p>
          <ul className="list-disc space-y-0.5 pl-5">
            <li>A frame carries a destination MAC and a source MAC.</li>
            <li>A network card keeps frames for its own MAC (or broadcast) and discards the rest.</li>
            <li>A switch decides which ports a frame goes out of. At first it may send it to everyone.</li>
          </ul>
        </>
      ),
      show: { nic: true },
    },
  ],
  2: [
    {
      id: "l2-empty",
      title: "A switch starts out knowing nothing",
      body: (v) => (
        <>
          <p>SW1 has four ports ({ethPortName(v, "ge-0/0/1")} to {ethPortName(v, "ge-0/0/4")}), each with a cable to one device. To deliver frames it keeps a {B("MAC address table")}: which MAC is behind which port. A switch that has just started has an {B("empty")} table.</p>
          <p>The port names now appear on the cables. They&apos;re the same names SW1&apos;s own command line uses.</p>
        </>
      ),
      setup: [FRESH],
      show: { ports: true, table: true },
      portsOnMap: true,
    },
    {
      id: "l2-first",
      title: "Frame 1: HOST-A → HOST-B, inside the switch",
      body: () => (
        <>
          <p>Send it and watch SW1 think. The steps appear as the frame reaches SW1, in the order the switch does them.</p>
        </>
      ),
      setup: [FRESH],
      run: { label: "HOST-A sends to HOST-B", actions: [send("HOST-A", "HOST-B")] },
      predict: "SW1's table is empty. Which ports do you think SW1 will send this frame out of? Click them, then send.",
      show: { ports: true, mind: true, table: true, frame: true },
      portsOnMap: true,
    },
    {
      id: "l2-learn",
      title: "It learned from the SOURCE, not the destination",
      body: (v) => (
        <>
          <p>SW1 now knows {B("HOST-A is behind " + ethPortName(v, "ge-0/0/1"))}. It learned that from the {B("source MAC")} of the frame and the port it {B("arrived on")}: if a frame from HOST-A came in on this port, HOST-A is that way.</p>
          <p>It learned nothing about HOST-B: a destination MAC says where the frame is going, not where HOST-B is. Not knowing HOST-B, SW1 {B("flooded")}: one copy out every other port that&apos;s up. That copy is the one HOST-C discarded.</p>
        </>
      ),
      show: { ports: true, mind: true, table: true },
      portsOnMap: true,
    },
    {
      id: "l2-reply",
      title: "Frame 2: HOST-B answers",
      body: () => <p>Before you send, predict again: SW1 knows HOST-A now.</p>,
      setup: [FRESH, send("HOST-A", "HOST-B")],
      run: { label: "HOST-B sends to HOST-A", actions: [send("HOST-B", "HOST-A")] },
      predict: "HOST-B → HOST-A. Which port(s) will SW1 use?",
      show: { ports: true, mind: true, table: true },
      portsOnMap: true,
    },
    {
      id: "l2-known",
      title: "Frame 3: HOST-A → HOST-B, now that SW1 knows both",
      body: () => <p>Both MACs are in the table. Predict, then send.</p>,
      setup: [FRESH, send("HOST-A", "HOST-B"), send("HOST-B", "HOST-A")],
      run: { label: "HOST-A sends to HOST-B", actions: [send("HOST-A", "HOST-B")] },
      predict: "Which port(s) this time?",
      show: { ports: true, mind: true, table: true, nic: true },
      portsOnMap: true,
    },
    {
      id: "l2-sum",
      title: "Flood when it doesn't know. Forward when it does.",
      body: () => (
        <>
          <p>That is the whole algorithm of a learning switch, applied to every frame:</p>
          <ol className="list-decimal space-y-0.5 pl-5">
            <li>Note the port the frame arrived on.</li>
            <li>{B("Learn")}: the source MAC is behind that port (new entry, or its age reset).</li>
            <li>Read the destination MAC and {B("look it up")}.</li>
            <li>Found: {B("forward")} out that one port. Not found: {B("flood")} out every other port.</li>
          </ol>
          <p>The switch never looked at an IP address, and it never changed the frame: what leaves is exactly what arrived.</p>
        </>
      ),
      show: { ports: true, table: true },
      portsOnMap: true,
    },
  ],
  3: [
    {
      id: "l3-bcast",
      title: "A broadcast is flooded on purpose",
      body: () => (
        <>
          <p>Sometimes a host wants to reach {B("everyone")} — for example to ask &quot;who has this IP address?&quot; (ARP). It sends to the broadcast MAC {M(BROADCAST_MAC)}. Predict what SW1 does, even with a full table.</p>
        </>
      ),
      setup: [FRESH, send("HOST-A", "HOST-B"), send("HOST-B", "HOST-A")],
      run: { label: "HOST-C sends a broadcast", actions: [send("HOST-C", "broadcast")] },
      predict: "HOST-C → broadcast. Which ports?",
      show: { ports: true, mind: true, table: true, nic: true },
      portsOnMap: true,
    },
    {
      id: "l3-two",
      title: "Two floods, two different reasons",
      body: () => (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-pv-warning/40 p-2">
            <p className="font-bold text-pv-warning">Unknown unicast</p>
            <p>For one specific host the switch hasn&apos;t learned yet. Flooded {B("because the switch doesn't know")}. Only that host keeps it; the others discard it. It stops as soon as the host has sent something.</p>
          </div>
          <div className="rounded-lg border border-pv-violet/50 p-2">
            <p className="font-bold text-pv-violet">Broadcast</p>
            <p>For {B("everyone")}. Flooded {B("by design")}, whatever the table says. Every host keeps it. A full table never stops it.</p>
          </div>
        </div>
      ),
      show: { table: true },
      portsOnMap: true,
    },
    {
      id: "l3-age",
      title: "Knowledge expires",
      body: () => (
        <>
          <p>A learned entry has an {B("age")}: the time since that MAC last appeared as a {B("source")}. Past the aging time ({FDB_AGING_SEC} s here), it&apos;s removed — the device may have left.</p>
          <p>Watch the ages: 200 s pass, HOST-A sends (only HOST-A&apos;s age resets — receiving a frame doesn&apos;t count), then 150 s more.</p>
        </>
      ),
      setup: [FRESH, send("HOST-A", "HOST-B"), send("HOST-B", "HOST-A"), send("HOST-C", "broadcast")],
      run: { label: "Let 200 s pass, HOST-A sends, 150 s more", actions: [{ type: "time", seconds: 200 }, send("HOST-A", "HOST-B"), { type: "time", seconds: 150 }] },
      show: { table: true, clock: true, ports: true, events: 8 },
      portsOnMap: true,
    },
    {
      id: "l3-forgot",
      title: "Forgotten means flooded again",
      body: () => <p>HOST-B and HOST-C were silent for 350 s and aged out. HOST-A still knows HOST-B&apos;s MAC — but SW1 doesn&apos;t know where it is any more. Predict.</p>,
      setup: [FRESH, send("HOST-A", "HOST-B"), send("HOST-B", "HOST-A"), send("HOST-C", "broadcast"), { type: "time", seconds: 200 }, send("HOST-A", "HOST-B"), { type: "time", seconds: 150 }],
      run: { label: "HOST-A sends to HOST-B", actions: [send("HOST-A", "HOST-B")] },
      predict: "HOST-B aged out. Which ports?",
      show: { table: true, mind: true, ports: true, clock: true, nic: true },
      portsOnMap: true,
    },
  ],
  4: [
    {
      id: "l4-desk",
      title: "DESK-SW has its own table",
      body: (v) => (
        <>
          <p>SW1&apos;s port {ethPortName(v, "ge-0/0/4")} leads to {B("DESK-SW")}, a small unmanaged switch at the hot desk. It runs the same algorithm, with {B("its own table")} — and it can only learn from frames that reach it.</p>
          <p>Send a broadcast from HOST-C: it reaches DESK-SW too. What does each switch learn, and on which port?</p>
        </>
      ),
      setup: [FRESH, send("HOST-A", "HOST-B"), send("HOST-B", "HOST-A")],
      run: { label: "HOST-C sends a broadcast", actions: [send("HOST-C", "broadcast")] },
      show: { table: true, deskTable: true, desk: true, ports: true },
      portsOnMap: true,
    },
    {
      id: "l4-move",
      title: "HOST-B moves to the hot desk",
      body: (v) => (
        <>
          <p>HOST-B&apos;s user unplugs and moves to the hot desk, behind DESK-SW. SW1&apos;s port {ethPortName(v, "ge-0/0/2")} loses its link — and a switch {B("flushes what it learned on a port that goes down")}.</p>
          <p>HOST-B is now plugged into DESK-SW. Does any switch know that yet?</p>
        </>
      ),
      setup: [FRESH, send("HOST-A", "HOST-B"), send("HOST-B", "HOST-A"), send("HOST-C", "broadcast")],
      run: { label: "Move HOST-B to the hot desk", actions: [{ type: "move-b", to: "desk" }] },
      show: { table: true, deskTable: true, ports: true, events: 3 },
      portsOnMap: true,
    },
    {
      id: "l4-speak",
      title: "The switches find HOST-B when it speaks",
      body: (v) => <p>No frame, no knowledge. HOST-B sends to HOST-A: DESK-SW learns it on its port 2, SW1 learns it behind {ethPortName(v, "ge-0/0/4")} — both from the source MAC, each on its own ingress port.</p>,
      setup: [FRESH, send("HOST-A", "HOST-B"), send("HOST-B", "HOST-A"), send("HOST-C", "broadcast"), { type: "move-b", to: "desk" }],
      run: { label: "HOST-B sends to HOST-A", actions: [send("HOST-B", "HOST-A")] },
      show: { table: true, deskTable: true, mind: true, desk: true, ports: true },
      portsOnMap: true,
    },
    {
      id: "l4-back",
      title: "HOST-B goes back to its own desk",
      body: (v) => (
        <>
          <p>HOST-B moves back to SW1 {ethPortName(v, "ge-0/0/2")}. DESK-SW&apos;s port 2 goes down (DESK-SW flushes HOST-B). SW1&apos;s {ethPortName(v, "ge-0/0/2")} comes up — and {B("a link coming up teaches nothing")}.</p>
          <p>Look closely at SW1&apos;s table after the move.</p>
        </>
      ),
      setup: [FRESH, send("HOST-A", "HOST-B"), send("HOST-B", "HOST-A"), send("HOST-C", "broadcast"), { type: "move-b", to: "desk" }, send("HOST-B", "HOST-A")],
      run: { label: "Move HOST-B back to SW1", actions: [{ type: "move-b", to: "sw1" }] },
      show: { table: true, deskTable: true, ports: true, events: 5 },
      portsOnMap: true,
    },
    {
      id: "l4-stale",
      title: "A table can be confidently wrong",
      body: (v) => <p>SW1 still says HOST-B is behind {ethPortName(v, "ge-0/0/4")}: {ethPortName(v, "ge-0/0/4")} never went down, so nothing flushed it, and HOST-B hasn&apos;t sent from its new port. That entry is {B("stale")}. Predict what happens to a frame for HOST-B.</p>,
      setup: [FRESH, send("HOST-A", "HOST-B"), send("HOST-B", "HOST-A"), send("HOST-C", "broadcast"), { type: "move-b", to: "desk" }, send("HOST-B", "HOST-A"), { type: "move-b", to: "sw1" }],
      run: { label: "HOST-A sends to HOST-B", actions: [send("HOST-A", "HOST-B")] },
      predict: "SW1 has an entry for HOST-B. Which port will it use?",
      show: { table: true, deskTable: true, mind: true, desk: true, ports: true, nic: true },
      portsOnMap: true,
    },
    {
      id: "l4-fix",
      title: "Fixing it: one frame from HOST-B",
      body: () => (
        <>
          <p>SW1 forwarded perfectly — to the wrong place. DESK-SW didn&apos;t know HOST-B either (it flushed it), flooded, and nobody kept the frame. Every light was green the whole time.</p>
          <p>The fix is the same algorithm: when HOST-B {B("sends anything")}, SW1 sees its MAC arrive on the right port and {B("moves")} the entry. (An engineer can also clear the entry from SW1&apos;s command line — that comes in the engineering workspace.)</p>
        </>
      ),
      setup: [FRESH, send("HOST-A", "HOST-B"), send("HOST-B", "HOST-A"), send("HOST-C", "broadcast"), { type: "move-b", to: "desk" }, send("HOST-B", "HOST-A"), { type: "move-b", to: "sw1" }, send("HOST-A", "HOST-B")],
      run: { label: "HOST-B sends, then HOST-A sends to HOST-B", actions: [send("HOST-B", "HOST-A"), send("HOST-A", "HOST-B")] },
      show: { table: true, mind: true, ports: true, nic: true },
      portsOnMap: true,
    },
  ],
};

/** The current step's panel: text, the action, the prediction, and the evidence the idea needs. */
export function LearnStepView({ lab, step, vendor, ran, picked, onPick, shownWave }: { lab: EthLabState; step: LStep; vendor: CliVendor; ran: boolean; picked: string[]; onPick: (p: string) => void; shownWave: number }) {
  const tx = lab.last?.type === "send" || lab.tx ? lab.tx : undefined;
  const showTx = !!tx && (ran || !step.run);
  const sw1 = tx?.decisions.find((d) => d.sw === "SW1");
  const landed = !!tx && shownWave >= tx.waves;
  const verdict = step.predict && ran && sw1 && landed ? (JSON.stringify([...picked].sort()) === JSON.stringify([...sw1.egress].sort()) ? "match" : "differ") : undefined;
  return (
    <div className="space-y-2.5">
      <div className="space-y-1.5 text-[13.5px] leading-relaxed text-pv-text-muted">{step.body(vendor)}</div>
      {step.predict && (
        <div className="space-y-1 rounded-xl border border-pv-violet/40 bg-pv-violet/[0.05] p-2">
          <p className="text-[12.5px] text-pv-text">
            <b className="text-pv-violet">Predict:</b> {step.predict}
          </p>
          <Faceplate lab={lab} vendor={vendor} picked={picked} onPick={ran ? undefined : onPick} tx={ran ? tx : undefined} shownWave={shownWave} />
          {verdict && (
            <p className={clsx("pv-pop text-[12.5px] font-semibold", verdict === "match" ? "text-pv-success" : picked.length ? "text-pv-warning" : "text-pv-text-muted")}>
              {verdict === "match" ? "✓ Exactly what SW1 did." : `${picked.length ? "Not quite: " : "(No prediction this time.) "}SW1 used ${sw1!.egress.length ? sw1!.egress.map((p) => ethPortName(vendor, p)).join(", ") : "no port"}${picked.length ? `; you picked ${picked.map((p) => ethPortName(vendor, p)).join(", ")}` : ""}. Its reasoning is below.`}
            </p>
          )}
        </div>
      )}
      {showTx && tx && step.show.frame && (
        <div className="space-y-1">
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-pv-text-faint">The frame</p>
          <FrameCard tx={tx} />
        </div>
      )}
      {showTx && tx && step.show.mind && (
        <div className="space-y-1">
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-pv-text-faint">Inside SW1, for this frame</p>
          <SwitchMind lab={lab} tx={tx} sw="SW1" vendor={vendor} shownWave={shownWave} />
          {step.show.desk && tx.decisions.some((d) => d.sw === "DESK-SW") && (
            <>
              <p className="pt-1 text-[10.5px] font-bold uppercase tracking-wide text-pv-text-faint">Inside DESK-SW</p>
              <SwitchMind lab={lab} tx={tx} sw="DESK-SW" vendor={vendor} shownWave={shownWave} />
            </>
          )}
        </div>
      )}
      {showTx && tx && step.show.nic && landed && (
        <div className="space-y-1">
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-pv-text-faint">What each network card did</p>
          <NicVerdicts lab={lab} tx={tx} />
        </div>
      )}
      {step.show.ports && !step.predict && <Faceplate lab={lab} vendor={vendor} tx={showTx ? tx : undefined} shownWave={shownWave} />}
      {(step.show.table || step.show.deskTable) && (
        <div className={clsx("grid gap-2", step.show.deskTable && "sm:grid-cols-2")}>
          {step.show.table && <MacTable lab={lab} sw="SW1" vendor={vendor} tx={showTx ? tx : undefined} />}
          {step.show.deskTable && <MacTable lab={lab} sw="DESK-SW" vendor={vendor} tx={showTx ? tx : undefined} />}
        </div>
      )}
      {step.show.clock && <p className="pv-mono text-[11.5px] text-pv-text-faint">lab clock: t = {lab.net.clock} s · aging time {lab.cfg.aging} s</p>}
      {step.show.events && ran && (
        <div className="space-y-0.5 rounded-xl border border-pv-border p-2">
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-pv-text-faint">What just happened, in order</p>
          {lab.log.slice(-step.show.events).map((l) => (
            <p key={l.id} className={clsx("text-[12px]", l.kind === "warning" ? "text-pv-warning" : "text-pv-text-muted")}>
              <span className="pv-mono text-pv-text-faint">{l.tag}</span> {ethVendorText(vendor, l.text)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
