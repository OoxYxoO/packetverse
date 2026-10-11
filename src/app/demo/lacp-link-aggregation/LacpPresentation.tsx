"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, PacketCard, ReplayButton, Token, Topo, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";

/**
 * LACP — the presentation before the lesson/lab. Builds on STP (parallel links are a loop; spanning tree blocks all but
 * one): SW1 ═ SW2 with two cables (ge-0/0/23, ge-0/0/24), hosts on both sides, bundled into one logical link with LACP;
 * the hash, what both ends must agree on, member failure and silent failure. Presentation state only.
 */

type Id = "why" | "stp" | "bundle" | "one" | "hash" | "single" | "lacpdu" | "fields" | "active" | "static" | "group" | "states" | "fail" | "silent" | "rate" | "stp-sees" | "verify" | "trouble" | "recap";
type Step = DeckStep & { id: Id };
const Bb = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const STEPS: Step[] = [
  { id: "why", chapter: "Why aggregate", title: "One cable between two switches is a bottleneck.", body: <p>Four hosts talk across the SW1–SW2 uplink. One 1 Gb/s cable carries all of it, and if it fails the floors are cut off. A second cable seems obvious.</p> },
  { id: "stp", chapter: "Why aggregate", title: "Two separate cables are a loop — spanning tree blocks one.", body: <p>You saw it in the STP lesson: two links between the same two switches are two paths. Spanning tree keeps one and blocks the other. You get redundancy, but <Bb>no extra bandwidth</Bb>.</p> },
  { id: "bundle", chapter: "One logical link", title: "Bundle the cables into a Port-channel.", body: <p>Both switches put the two ports in one group — Cisco <Bb>Port-channel1</Bb>, Junos <Bb>ae0</Bb>. To everything above, the bundle is <Bb>one link</Bb>: one MAC-table port, one spanning-tree port.</p> },
  { id: "one", chapter: "One logical link", title: "Spanning tree sees one port — nothing to block.", body: <p>There is only one path now: Po1, with cost 10000 (two members share the 20000 of one link). Both cables carry traffic, and if one fails the Port-channel simply keeps going on the other.</p> },
  { id: "hash", chapter: "Spreading the load", title: "A hash picks one member per flow.", body: <p>The switch looks at each frame&apos;s source and destination (here: IP addresses) and computes a number that picks a member. HOST-A → HOST-B lands on one cable, HOST-A → HOST-C on the other. Every frame of a flow takes the same member, so they never arrive out of order.</p> },
  { id: "single", chapter: "Spreading the load", title: "One flow never goes faster than one cable.", body: <p>A Port-channel of 2 × 1 Gb/s gives <Bb>many</Bb> flows 2 Gb/s together. A single file transfer still runs at 1 Gb/s: it is one flow, on one member.</p> },
  { id: "lacpdu", chapter: "LACP", title: "LACP: both ends agree, cable by cable.", body: <p>Static bundling trusts the configuration and the cabling blindly. <Bb>LACP</Bb> (IEEE 802.1AX) has each switch send <Bb>LACPDUs</Bb> on every member: “I am system X, this port is in my group K.” A member is used only when both ends agree.</p> },
  { id: "fields", chapter: "LACP", title: "Inside an LACPDU.", body: <p>Sent to the Slow Protocols address 01:80:C2:00:00:02 with EtherType 0x8809 — link-local, never forwarded, never IP. Each carries the sender&apos;s view (Actor) and what it heard (Partner).</p> },
  { id: "active", chapter: "What must match", title: "Someone has to start: active and passive.", body: <p>An <Bb>active</Bb> port sends LACPDUs on its own; a <Bb>passive</Bb> port only answers. Active ↔ active and active ↔ passive bundle. Passive ↔ passive never starts: the Port-channel stays down.</p> },
  { id: "static", chapter: "What must match", title: "Static and LACP don't mix.", body: <p>A static (“on”) port bundles without sending LACPDUs. If the other end runs LACP, it hears nothing and <Bb>suspends</Bb> its ports — while the static side forwards into a bundle that leads nowhere. Both ends must be LACP (or both static).</p> },
  { id: "group", chapter: "What must match", title: "All members must lead to the same partner group.", body: <p>If SW2 puts one cable in group 2 by mistake, SW1 sees two different partner keys on its two members. One Port-channel can only lead to one partner Port-channel: SW1 keeps one member and <Bb>suspends</Bb> the other. It works — on half the bandwidth.</p> },
  { id: "states", chapter: "What must match", title: "From link up to forwarding.", body: <p>Per member: the partner is heard and in sync → <Bb>Collecting</Bb> (accept frames) → <Bb>Distributing</Bb> (send frames). Only Collecting + Distributing members get flows from the hash.</p> },
  { id: "fail", chapter: "When a member fails", title: "A cable goes down: the member leaves at once.", body: <p>Unplug ge-0/0/24: its link goes down at both ends, it leaves the bundle immediately, and the hash moves its flows to the remaining member. The Port-channel stays up; spanning tree doesn&apos;t notice.</p> },
  { id: "silent", chapter: "When a member fails", title: "A silent failure: the link stays up, frames vanish.", body: <p>A media converter dies: the link LED stays green, so nothing goes down — but nothing gets through. Flows hashed onto that cable disappear. Only LACP can notice: its LACPDUs stop arriving.</p> },
  { id: "rate", chapter: "When a member fails", title: "Slow rate: 90 s. Fast rate: 3 s.", body: <p>By default LACPDUs come every 30 s and a partner is timed out after 90 s. With the fast rate (Cisco lacp rate fast · Junos lacp periodic fast) they come every second and a dead member is removed after 3 s.</p> },
  { id: "stp-sees", chapter: "LACP and STP together", title: "LACP builds the link; spanning tree protects the network.", body: <p>Not either-or: LACP turns parallel cables into one logical link, and spanning tree still guards the rest of the topology — it just sees the Port-channel as one port.</p> },
  { id: "verify", chapter: "Verify on the devices", title: "Read the bundle at both ends.", body: <p>Which members are bundled? What partner does each member see? How fast would a failure be noticed?</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Up cables, missing bandwidth: read both ends.", body: <p>Most aggregation problems leave every link light green.</p> },
  { id: "recap", chapter: "The whole idea", title: "Many cables, one link — if both ends agree.", body: <p>Now watch LACP bundle the cables in the lesson, then break and repair it in the LACP Lab.</p> },
];
const VISUAL: Record<Id, string> = { why: "net", stp: "net", bundle: "net", one: "net", hash: "net", single: "net", lacpdu: "net", fields: "pdu", active: "modes", static: "net", group: "net", states: "states", fail: "net", silent: "net", rate: "rate", "stp-sees": "compare", verify: "verify", trouble: "trouble", recap: "recap" };

const NODES: TopoNode[] = [
  { id: "a", label: "HOST-A", sub: ".10", icon: "💻", x: 8, y: 22 },
  { id: "d", label: "HOST-D", sub: ".11", icon: "💻", x: 8, y: 80 },
  { id: "sw1", label: "SW1", icon: "⇄", x: 33, y: 50 },
  { id: "sw2", label: "SW2", icon: "⇄", x: 67, y: 50 },
  { id: "b", label: "HOST-B", sub: ".20", icon: "💻", x: 92, y: 22 },
  { id: "c", label: "HOST-C", sub: ".21", icon: "💻", x: 92, y: 80 },
];
const A23: [number, number] = [37, 44];
const B23: [number, number] = [63, 44];
const A24: [number, number] = [37, 56];
const B24: [number, number] = [63, 56];
function Cables({ id }: { id: Id }) {
  const one = id === "why";
  const st23 = "#22d3ee";
  const st24 = id === "stp" ? "#f59e0b" : id === "fail" ? "#3a4460" : id === "silent" ? "#f87171" : id === "static" || id === "group" ? "#f87171" : "#22d3ee";
  const dash24 = id === "stp" ? "6 4" : id === "fail" ? "3 5" : id === "silent" || id === "static" || id === "group" ? "2 3" : undefined;
  const bundled = !["why", "stp"].includes(id);
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      <line x1={33} y1={one ? 50 : 44} x2={67} y2={one ? 50 : 44} stroke={id === "static" ? "#f87171" : st23} strokeWidth={3} strokeDasharray={id === "static" ? "2 3" : undefined} vectorEffect="non-scaling-stroke" />
      {!one && <line x1={33} y1={56} x2={67} y2={56} stroke={st24} strokeWidth={3} strokeDasharray={dash24} vectorEffect="non-scaling-stroke" />}
      {bundled && (
        <>
          <rect x={36} y={40} width={6} height={20} rx={3} fill="none" stroke="#22d3ee" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
          <rect x={58} y={40} width={6} height={20} rx={3} fill="none" stroke="#22d3ee" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
        </>
      )}
    </svg>
  );
}
function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const id = s.id;
  const k = `${id}-${play}`;
  const head = <StageHead chapter={s.chapter} title={s.title} />;
  const mv = (from: [number, number], to: [number, number], label: string, key: string, o: { delay?: number; color?: string; stay?: boolean } = {}) => (
    <Mover key={`${k}-${key}`} from={from} to={to} delay={o.delay} duration={800} stay={o.stay}>
      <Token color={o.color ?? "cyan"}>{label}</Token>
    </Mover>
  );
  if (VISUAL[id] === "net") {
    const links: TopoLink[] = [
      { a: "a", b: "sw1" },
      { a: "d", b: "sw1" },
      { a: "sw2", b: "b" },
      { a: "sw2", b: "c" },
    ];
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "why") views.sw1 = { bubble: { text: "everything through one 1 Gb/s cable", tone: "warn" } };
    if (id === "stp") views.sw2 = { bubble: { text: "ge-0/0/24: Alternate (blocked)", tone: "warn" } };
    if (id === "bundle" || id === "one") {
      views.sw1 = { badge: { text: "Po1 / ae0", tone: "info" } };
      views.sw2 = { badge: { text: "Po1 / ae0", tone: "info" } };
      if (id === "one") views.sw2 = { bubble: { text: "STP: one port, Po1 — forwarding", tone: "yes" } };
    }
    if (id === "hash" || id === "single") {
      movers = (
        <>
          {mv(A23, B23, "A→B", "1")}
          {mv(A24, B24, "A→C", "2", { delay: 200, color: "amber" })}
        </>
      );
      views.sw1 = { bubble: { text: id === "hash" ? "(10+20) mod 2 = 0 → ge-0/0/23 · (10+21) mod 2 = 1 → ge-0/0/24" : "one flow = one member = 1 Gb/s max", tone: "info" } };
    }
    if (id === "lacpdu") {
      movers = (
        <>
          {mv(A23, B23, "LACPDU", "1", { color: "violet" })}
          {mv(B24, A24, "LACPDU", "2", { delay: 300, color: "violet" })}
        </>
      );
    }
    if (id === "static") {
      movers = mv(B23, A23, "frames", "1", { color: "red", stay: true });
      views.sw2 = { bubble: { text: "static “on”: no LACPDUs, I forward", tone: "warn" } };
      views.sw1 = { ring: "bad", bubble: { text: "LACP: no partner → members suspended", tone: "bad", delay: 600 } };
    }
    if (id === "group") views.sw1 = { ring: "bad", bubble: { text: "partner key 1 on 23, key 2 on 24 → suspend 24", tone: "bad" } };
    if (id === "fail") {
      movers = (
        <>
          {mv(A23, B23, "A→B", "1")}
          {mv(A23, B23, "A→C", "2", { delay: 300, color: "amber" })}
        </>
      );
      views.sw1 = { bubble: { text: "ge-0/0/24 down → both flows on 23", tone: "yes" } };
    }
    if (id === "silent") {
      movers = mv(A24, B24, "A→C", "1", { color: "red", stay: true });
      views.sw1 = { ring: "bad", bubble: { text: "link up… frames lost", tone: "bad", delay: 400 } };
    }
    return (
      <>
        {head}
        <Topo nodes={NODES} links={links} views={views} ratio={44} minH={230}>
          <Cables id={id} />
          {movers}
        </Topo>
        {["hash", "single", "lacpdu", "static", "fail", "silent"].includes(id) && <ReplayButton onClick={replay} />}
      </>
    );
  }
  switch (id) {
    case "fields":
      return (
        <>
          {head}
          <PacketCard
            layers={[
              { name: "Ethernet", color: "#94a3b8", fields: [{ k: "Destination", v: "01:80:C2:00:00:02" }, { k: "Source", v: "SW1's port MAC" }, { k: "EtherType", v: "0x8809", hi: "key" }] },
              { name: "LACPDU (subtype 0x01)", color: "#a78bfa", fields: [{ k: "Actor system", v: "32768 · SW1" }, { k: "Actor key", v: "1 (its group)", hi: "key" }, { k: "Actor port", v: "23" }, { k: "Actor state", v: "Active · Sync · Collecting · Distributing" }, { k: "Partner system / key", v: "SW2 · 1", hi: "key" }, { k: "Partner state", v: "what SW1 heard from SW2" }] },
            ]}
          />
        </>
      );
    case "active":
      return (
        <>
          {head}
          <MiniTable title="Which modes bundle" cols={["SW1", "SW2", "Result"]} rows={[{ cells: ["active", "active", "bundle"], state: "best" }, { cells: ["active", "passive", "bundle"], state: "best" }, { cells: ["passive", "passive", "never starts"], state: "bad" }, { cells: ["on (static)", "on (static)", "bundle, no checks"], state: "hit" }, { cells: ["on (static)", "active", "LACP side suspends"], state: "bad" }]} />
        </>
      );
    case "states":
      return (
        <>
          {head}
          <Chain k="st" horizontal items={[{ t: "link up", tone: "plain" }, { t: "partner heard", tone: "cyan" }, { t: "in sync (same group)", tone: "violet" }, { t: "Collecting", tone: "amber" }, { t: "Distributing", tone: "green" }]} />
        </>
      );
    case "rate":
      return (
        <>
          {head}
          <Compare items={[{ title: "Slow (default)", tone: "amber", body: "LACPDU every 30 s · timeout 90 s: flows on a silent member are lost for up to 90 s" }, { title: "Fast", tone: "green", body: "LACPDU every second · timeout 3 s: Cisco lacp rate fast · Junos lacp periodic fast" }]} />
        </>
      );
    case "stp-sees":
      return (
        <>
          {head}
          <Compare items={[{ title: "LACP", tone: "cyan", body: "parallel cables between the SAME two switches → one logical link; all members forward" }, { title: "Spanning tree", tone: "violet", body: "redundant paths through DIFFERENT switches → blocks loops; sees a Port-channel as one port" }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniTable title="Cisco IOS" cols={["Question", "Command"]} rows={[{ cells: ["Bundled? (P / s / D)", "show etherchannel summary"] }, { cells: ["What the partner says", "show lacp neighbor"] }, { cells: ["My own LACP state", "show lacp internal"] }, { cells: ["Bandwidth, members", "show interfaces port-channel 1"] }, { cells: ["How flows are hashed", "show etherchannel load-balance"] }]} />
            <MiniTable title="Junos" cols={["Question", "Command"]} rows={[{ cells: ["Actor/partner, mux state", "show lacp interfaces"] }, { cells: ["ae speed, members", "show interfaces ae0"] }, { cells: ["Which ae a port is in", "show interfaces terse"] }, { cells: ["Configuration", "show configuration interfaces ae0"] }, { cells: ["STP sees ae0", "show spanning-tree interface"] }]} />
          </div>
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain k="ts" items={[{ t: "Symptom: no traffic, half the bandwidth, or some flows lost", tone: "red" }, { t: "Is every member bundled at BOTH ends? (P vs s · Collecting distributing vs Attached)", tone: "cyan" }, { t: "Both ends LACP, at least one active? Same group on every member?", tone: "amber" }, { t: "What does spanning tree see: one Po, or separate ports?", tone: "violet" }, { t: "Silent failure? How fast does LACP time out (rate)?", tone: "amber" }, { t: "Fix one thing, prove it with several flows", tone: "green" }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "Separate parallel cables: a loop, one blocked" }, { t: "A Port-channel is one logical link: all members forward", tone: "cyan" }, { t: "The hash spreads flows; one flow stays on one member", tone: "violet" }, { t: "LACP verifies every member: active start, no static mix, one partner group", tone: "amber" }, { t: "Members leave on link-down at once; silent failures need LACP (fast: 3 s)", tone: "green" }]} />
        </>
      );
  }
  return head;
}
export function LacpPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return <LessonPresentation open={open} onClose={onClose} title="Link aggregation, from zero" kicker="Learn · the LACP presentation" steps={STEPS} visual={(s) => VISUAL[s.id]} renderStage={(s) => <Deck step={s} play={play} replay={() => setPlay((p) => p + 1)} />} finish={{ label: finishLabel, onClick: onFinish }} skip={{ label: "Skip →", onClick: onFinish }} />;
}
