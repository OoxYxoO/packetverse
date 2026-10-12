"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, MiniTable, ReplayButton, Token, Topo, nodeAt, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { useFitNodes } from "@/components/presentation/fitNarrow";
import { L2_IP, L2_MAC, MGMT, tci } from "@/lib/sim-engine/scenarios/troubleshootingLayer2";
import { createL2Net, l2Apply, l2Stp, l2TicketState, lastTest, liveFdb, type L2Action, type L2State } from "@/lib/sim-engine/scenarios/l2Net";

/**
 * Layer 2 Troubleshooting — the presentation before the lesson and the lab. Spanning-tree roles, MAC table entries and
 * ping results on the slides are read from the lab model (l2Net.ts). Presentation state only.
 */

type Id = "problem" | "guess" | "net" | "learn" | "flood" | "vlans" | "access" | "trunk" | "tag" | "allowed" | "native" | "loop" | "root" | "block" | "incident" | "follow" | "mac" | "vlan20" | "cause" | "repair" | "proof" | "others" | "recap";
type Step = DeckStep & { id: Id };
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const run = (s: L2State, ...a: L2Action[]) => a.reduce((x, y) => l2Apply(x, y), s);
const pAB: L2Action = { type: "ping", from: "HOST-A", to: L2_IP["HOST-B"], count: 4 };
const H = run(createL2Net(0), pAB);
const ST = l2Stp(H);
const ALT = Object.entries(ST.ports).find(([, p]) => p.role === "Alternate")![0].replace(":", " ");
const INC = run(l2TicketState("prune", 1), pAB, { type: "ping", from: "SW1", to: MGMT.SW3.ip, count: 4 });
const sw3A = (s: L2State) => liveFdb(s, "SW3").find((e) => e.mac === L2_MAC["HOST-A"]);
const FIX = run(INC, { type: "set", text: "fix", f: (s) => void (s.cfg.SW2.ports["ge-0/0/51"].members = [10, 20]) }, pAB);
const T = tci(10);

const STEPS: Step[] = [
  { id: "problem", chapter: "The question", title: "“HOST-A can't reach HOST-B.”", body: <p>Since last night&apos;s trunk clean-up, HOST-A (<M>{L2_IP["HOST-A"]}</M>) can&apos;t reach HOST-B (<M>{L2_IP["HOST-B"]}</M>). Every link light is on, the switches answer on their management addresses, spanning tree looks normal.</p> },
  { id: "guess", chapter: "The question", title: "“Everything is up.”", body: <p>Up links say nothing about which VLANs cross them, how frames are tagged, or where a switch thinks a MAC lives. Layer 2 keeps its evidence in tables — you just have to read them.</p> },
  { id: "net", chapter: "The network", title: "Three switches in a triangle.", body: <p>HOST-A on SW1, HOST-B on SW3, both in VLAN <M>10</M>. SW1, SW2 and SW3 are joined by trunks that carry VLAN 10 (users) and VLAN 20 (switch management).</p> },
  { id: "learn", chapter: "How switches work", title: "Learn from the source.", body: <p>Every frame carries its sender&apos;s MAC. A switch records <B>VLAN + MAC → port</B> for each frame it receives — that is its MAC table. Entries age out after 300 s.</p> },
  { id: "flood", chapter: "How switches work", title: "Flood the unknown.", body: <p>HOST-A&apos;s first frame is an ARP broadcast. A broadcast — or a destination not yet in the table — is flooded out of every port in the same VLAN. HOST-B&apos;s reply teaches the switches the way back.</p> },
  { id: "vlans", chapter: "VLANs", title: "Separate broadcast domains.", body: <p>A VLAN splits the same switches into separate broadcast domains. VLAN 10 frames never reach VLAN 20 ports; crossing needs a router.</p> },
  { id: "access", chapter: "VLANs", title: "Access ports: one VLAN, untagged.", body: <p>The hosts&apos; ports are access ports in VLAN 10. Frames enter and leave them untagged — the host never knows its VLAN.</p> },
  { id: "trunk", chapter: "VLANs", title: "Trunks: many VLANs, tagged.", body: <p>Between switches, one link carries several VLANs. Each frame gets a 4-byte <B>802.1Q tag</B> naming its VLAN; the receiving switch reads it and keeps the frame in that VLAN.</p> },
  { id: "tag", chapter: "VLANs", title: "Inside the tag.", body: <p>TPID <M>0x8100</M> says “a tag follows”; the TCI holds priority, DEI and the 12-bit VLAN ID. VLAN 10 with priority 0: TCI <M>0x{T.toString(16).padStart(4, "0")}</M>.</p> },
  { id: "allowed", chapter: "Trunks", title: "A trunk carries a list.", body: <p>Each trunk end has a member list. A VLAN not in it is neither sent nor accepted on that link — silently. The link stays up and every other VLAN keeps working.</p> },
  { id: "native", chapter: "Trunks", title: "One VLAN without a tag.", body: <p>A trunk also sends one VLAN untagged: its <B>native VLAN</B> (here 1). Both ends must agree — otherwise frames sent untagged as one VLAN arrive as another.</p> },
  { id: "loop", chapter: "Spanning tree", title: "A triangle is a loop.", body: <p>Three switches joined in a ring: a broadcast would travel round forever, copied at every switch. Ethernet frames have no TTL to stop them.</p> },
  { id: "root", chapter: "Spanning tree", title: "Elect a root.", body: <p>RSTP elects the bridge with the lowest priority — SW2 (<M>4096</M>). Every other switch picks its <B>root port</B>: the cheapest way to SW2.</p> },
  { id: "block", chapter: "Spanning tree", title: "Block one port.", body: <p>On the SW1–SW3 link, SW3 has the better bridge ID, so <M>{ALT}</M> becomes <B>Alternate</B> and discards. The triangle becomes a tree; traffic between the hosts goes SW1 → SW2 → SW3.</p> },
  { id: "incident", chapter: "The incident", title: "The ping fails.", body: <p>Today: HOST-A → HOST-B {lastTest(run(l2TicketState("prune", 1), pAB)).unreachable ? "gets no ARP reply — 100% loss" : "fails"}. Links up, RSTP unchanged.</p> },
  { id: "follow", chapter: "The incident", title: "Follow the frame.", body: <p>The ARP leaves SW1 tagged 10 and reaches SW2. SW2 should send it on toward SW3 — but nothing leaves SW2 toward SW3 in VLAN 10.</p> },
  { id: "mac", chapter: "The incident", title: "The tables agree.", body: <p>SW2 has learned HOST-A in VLAN 10; SW3 has {sw3A(INC) ? "learned it" : <B>never learned it</B>}. The frame stops between them.</p> },
  { id: "vlan20", chapter: "The incident", title: "VLAN 20 still crosses.", body: <p>SW1 pings SW3&apos;s management address across the same SW2–SW3 trunk: {INC.tests[1].recv}/{INC.tests[1].sent}. The link is fine; only VLAN 10 is missing.</p> },
  { id: "cause", chapter: "The incident", title: "One trunk, one missing VLAN.", body: <p>SW2 <M>ge-0/0/51</M>&apos;s member list: <M>MGMT</M> only. The clean-up removed <M>USERS</M>.</p> },
  { id: "repair", chapter: "Proof", title: "Add VLAN 10 back.", body: <p>Add <M>USERS</M> to SW2 <M>ge-0/0/51</M> and commit. Nothing else changes: same links, same tree.</p> },
  { id: "proof", chapter: "Proof", title: "Prove it with fresh traffic.", body: <p>A fresh ping: {lastTest(FIX).recv}/{lastTest(FIX).sent}. SW3 now learns HOST-A on <M>{sw3A(FIX)?.port}</M> in VLAN 10 — the frame crossed the trunk.</p> },
  { id: "others", chapter: "Proof", title: "Other ways Layer 2 breaks.", body: <p>A host port in the wrong VLAN, natives that disagree, an access port facing a trunk, a switch without spanning tree. Each leaves a different fingerprint in the tables.</p> },
  { id: "recap", chapter: "The whole idea", title: "Read the tables.", body: <p>Now follow it in the lesson, then break and repair VLANs, trunks and spanning tree yourself in the Layer 2 Lab.</p> },
];
const VISUAL: Record<Id, string> = Object.fromEntries(STEPS.map((s) => [s.id, ["tag", "others", "recap"].includes(s.id) ? s.id : "topo"])) as Record<Id, string>;

const NODES: TopoNode[] = [
  { id: "HOST-A", label: "HOST-A", sub: L2_IP["HOST-A"], icon: "host", x: 9, y: 82 },
  { id: "SW1", label: "SW1", sub: "prio 32768", icon: "SW", x: 27, y: 52 },
  { id: "SW2", label: "SW2", sub: "root · 4096", icon: "SW", x: 50, y: 16 },
  { id: "SW3", label: "SW3", sub: "prio 8192", icon: "SW", x: 73, y: 52 },
  { id: "HOST-B", label: "HOST-B", sub: L2_IP["HOST-B"], icon: "host", x: 91, y: 82 },
];
const LINKS: [string, string][] = [["HOST-A", "SW1"], ["SW1", "SW2"], ["SW1", "SW3"], ["SW2", "SW3"], ["SW3", "HOST-B"]];

function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const FIT = useFitNodes(NODES, 270);
  const id = s.id;
  const k = `${id}-${play}`;
  const head = <StageHead chapter={s.chapter} title={s.title} />;
  const go = (f: string, t: string, o: { label: string; key: string; delay?: number; color?: string }) => (
    <Mover key={`${k}-${o.key}`} from={nodeAt(FIT.nodes, f)} to={nodeAt(FIT.nodes, t)} delay={o.delay} duration={700}>
      <Token color={o.color ?? "cyan"}>{o.label}</Token>
    </Mover>
  );
  if (VISUAL[id] === "topo") {
    const showTree = ["root", "block", "incident", "follow", "mac", "vlan20", "cause", "repair", "proof", "flood", "learn", "trunk"].includes(id);
    const state = (a: string, b: string): TopoLink["state"] => {
      if (showTree && a === "SW1" && b === "SW3") return "blocked";
      if (id === "loop" && a.startsWith("SW") && b.startsWith("SW")) return "active";
      if (["cause", "follow"].includes(id) && a === "SW2" && b === "SW3") return "down";
      return "up";
    };
    const links: TopoLink[] = LINKS.map(([a, b]) => ({ a, b, state: state(a, b), label: a === "SW1" && b === "SW3" && showTree ? "ALT" : "" }));
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "problem") views["HOST-A"] = { bubble: { text: "can't reach HOST-B", tone: "warn" } };
    if (id === "guess") views.SW2 = { bubble: { text: "all links up", tone: "yes" } };
    if (id === "learn") views.SW1 = { ring: "on", bubble: { text: "VLAN 10 · …:0a → ge-0/0/1", tone: "info" } };
    if (id === "flood") movers = <>{go("HOST-A", "SW1", { label: "ARP ?", key: "1", color: "amber" })}{go("SW1", "SW2", { label: "ARP ?", key: "2", delay: 700, color: "amber" })}{go("SW2", "SW3", { label: "ARP ?", key: "3", delay: 1400, color: "amber" })}{go("SW3", "HOST-B", { label: "ARP ?", key: "4", delay: 2100, color: "amber" })}</>;
    if (id === "vlans") {
      views["HOST-A"] = { bubble: { text: "VLAN 10", tone: "info" } };
      views.SW2 = { bubble: { text: "VLAN 20: switch management", tone: "ask" } };
    }
    if (id === "access") views["HOST-B"] = { ring: "on", bubble: { text: "untagged", tone: "info" } };
    if (id === "trunk") movers = <>{go("SW1", "SW2", { label: "tag 10", key: "1" })}{go("SW2", "SW3", { label: "tag 10", key: "2", delay: 700 })}</>;
    if (id === "allowed") views.SW2 = { ring: "on", bubble: { text: "members: USERS MGMT", tone: "info" } };
    if (id === "native") views.SW1 = { bubble: { text: "native VLAN 1 = untagged", tone: "info" } };
    if (id === "loop") movers = <>{go("SW1", "SW2", { label: "broadcast", key: "1", color: "red" })}{go("SW2", "SW3", { label: "broadcast", key: "2", delay: 600, color: "red" })}{go("SW3", "SW1", { label: "broadcast", key: "3", delay: 1200, color: "red" })}</>;
    if (id === "root") views.SW2 = { ring: "target", bubble: { text: "root bridge", tone: "yes" } };
    if (id === "block") views.SW1 = { ring: "hit", bubble: { text: "ge-0/0/50 Alternate", tone: "warn" } };
    if (id === "incident") views["HOST-A"] = { ring: "bad", bubble: { text: "no ARP reply", tone: "bad" } };
    if (id === "follow") {
      movers = <>{go("HOST-A", "SW1", { label: "ARP ?", key: "1", color: "amber" })}{go("SW1", "SW2", { label: "tag 10", key: "2", delay: 700, color: "amber" })}</>;
      views.SW2 = { ring: "bad", bubble: { text: "nothing out toward SW3", tone: "bad" } };
    }
    if (id === "mac") {
      views.SW2 = { ring: "hit", bubble: { text: "knows HOST-A", tone: "yes" } };
      views.SW3 = { ring: "bad", bubble: { text: "never saw HOST-A", tone: "bad" } };
    }
    if (id === "vlan20") movers = <>{go("SW1", "SW2", { label: "tag 20", key: "1", color: "violet" })}{go("SW2", "SW3", { label: "tag 20", key: "2", delay: 700, color: "violet" })}</>;
    if (id === "cause") views.SW2 = { ring: "bad", bubble: { text: "ge-0/0/51: MGMT only", tone: "bad" } };
    if (id === "repair") views.SW2 = { ring: "hit", bubble: { text: "+ USERS", tone: "yes" } };
    if (id === "proof") views.SW3 = { ring: "hit", bubble: { text: "HOST-A on ge-0/0/51", tone: "yes" } };
    return (
      <>
        {head}
        <Topo nodes={FIT.nodes} links={links} views={views} ratio={50} minH={FIT.minH}>
          {movers}
        </Topo>
        {movers && <ReplayButton onClick={replay} />}
      </>
    );
  }
  switch (id) {
    case "tag":
      return (
        <>
          {head}
          <MiniTable title="The 802.1Q tag on the trunk (VLAN 10)" cols={["field", "bits", "value"]} rows={[{ cells: ["TPID", "16", "0x8100"] }, { cells: ["PCP (priority)", "3", "0"] }, { cells: ["DEI", "1", "0"] }, { cells: ["VID (VLAN ID)", "12", "10"], state: "hit" }, { cells: ["TCI (PCP·DEI·VID)", "16", `0x${T.toString(16).padStart(4, "0")}`] }]} />
        </>
      );
    case "others":
      return (
        <>
          {head}
          <MiniTable title="Fingerprints" cols={["fault", "what the tables show"]} rows={[{ cells: ["VLAN missing on a trunk", "frame stops; other VLANs fine"], state: "hit" }, { cells: ["host port in wrong VLAN", "host's MAC learned in the other VLAN"] }, { cells: ["native mismatch", "MAC learned in VLAN default"] }, { cells: ["access vs trunk", "all VLANs dropped; input drops"] }, { cells: ["no spanning tree", "storm, flapping MACs"], state: "bad" }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "Learn source, flood unknown, forward known" }, { t: "Access untagged, trunk tagged", tone: "cyan" }, { t: "A trunk carries only its member VLANs", tone: "violet" }, { t: "Both ends agree on mode and native", tone: "amber" }, { t: "RSTP blocks exactly one port of a loop", tone: "green" }]} />
        </>
      );
  }
  return head;
}

export function L2Presentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="Switching, VLANs and loops, from zero"
      kicker="Learn · the Layer 2 presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id as Id]}
      renderStage={(s) => <Deck step={s as Step} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
