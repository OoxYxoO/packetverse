"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, PacketCard, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";

/**
 * VLANS & TRUNKING — the presentation before the lesson/lab. Builds on Switching (two learning switches, one broadcast
 * domain): the same SW1 + SW2, now split into VLAN 10 (HOST-A, HOST-B · 192.168.10.0/24) and VLAN 20 (HOST-C, HOST-D ·
 * 192.168.20.0/24), the 802.1Q trunk between them, per-VLAN learning, allowed lists and the native VLAN, and R1 on a
 * trunk joining the two VLANs. Presentation state only.
 */

type Id = "why" | "split" | "domain" | "bcast" | "hosts" | "problem" | "tag" | "path" | "lanes" | "classify" | "tables" | "allowed" | "native" | "mismatch" | "need-router" | "stick" | "hairpin" | "verify" | "trouble" | "recap";
type Step = DeckStep & { id: Id };
const Bb = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const V10 = () => <b style={{ color: "#22d3ee" }}>VLAN 10</b>;
const V20 = () => <b style={{ color: "#a78bfa" }}>VLAN 20</b>;

const STEPS: Step[] = [
  { id: "why", chapter: "Why VLANs", title: "One LAN for everyone gets crowded.", body: <p>In Switching, SW1 and SW2 formed <Bb>one broadcast domain</Bb>: every ARP, every flood reached every host. Now Sales and Engineering share those switches. Every broadcast of one team lands on the other&apos;s machines, and nothing separates them.</p> },
  { id: "split", chapter: "Why VLANs", title: "Separate switches would fix it — VLANs do it in software.", body: <p>Two sets of switches and cables per floor would split the LAN, at twice the cost. A <Bb>VLAN</Bb> (virtual LAN) does the same inside the switches you have: each port is assigned to a VLAN, and the switch keeps VLANs apart as if they were different boxes.</p> },
  { id: "domain", chapter: "What a VLAN is", title: "Two broadcast domains on the same two switches.", body: <p>HOST-A and HOST-B (Sales, 192.168.10.0/24) are in <V10 />; HOST-C and HOST-D (Engineering, 192.168.20.0/24) in <V20 />. One VLAN = one subnet, by design.</p> },
  { id: "bcast", chapter: "What a VLAN is", title: "A broadcast stays in its VLAN — on every switch.", body: <p>HOST-A&apos;s ARP request arrives on a VLAN 10 port. SW1 floods it to <Bb>VLAN 10 ports only</Bb> and to SW2, which does the same. HOST-C, one port away on SW1, never sees it.</p> },
  { id: "hosts", chapter: "What a VLAN is", title: "Hosts don't know about VLANs. Ports decide.", body: <p>A host sends ordinary, untagged frames. The switch puts each frame into the VLAN of the <Bb>access port</Bb> it arrived on. Plug the same laptop into a VLAN 20 port and it is in Engineering — with its Sales address, which no longer fits.</p> },
  { id: "problem", chapter: "The trunk", title: "Two VLANs, one cable between the switches.", body: <p>Both VLANs have hosts on both switches, but there is one link SW1↔SW2. When a frame arrives on that link, the port can&apos;t tell SW2 which VLAN it belongs to: it carries both.</p> },
  { id: "tag", chapter: "The trunk", title: "802.1Q: a 4-byte tag that names the VLAN.", body: <p>On a <Bb>trunk</Bb>, the sending switch inserts a tag after the source MAC: <Bb>TPID 0x8100</Bb> (“a tag follows”), then priority, DEI and the 12-bit <Bb>VLAN ID</Bb> (1–4094). The MAC addresses and the payload are untouched.</p> },
  { id: "path", chapter: "The trunk", title: "Untagged → tagged → untagged.", body: <p>HOST-A → HOST-B: untagged on SW1&apos;s access port, <Bb>tagged VID 10</Bb> on the trunk, untagged again out SW2&apos;s access port. The tag lives on the trunk only; hosts never see it.</p> },
  { id: "lanes", chapter: "The trunk", title: "Every VLAN rides the same trunk, in its own lane.", body: <p>HOST-C → HOST-D crosses the same cable tagged <Bb>VID 20</Bb>. The tags keep the two VLANs apart on the shared link, so a trunk is like a bundle of lanes, one per VLAN.</p> },
  { id: "classify", chapter: "Inside the switch", title: "First question for every frame: which VLAN?", body: <p>Untagged on an access port → the port&apos;s VLAN. Tagged on a trunk → the VID. Untagged on a trunk → the trunk&apos;s <Bb>native VLAN</Bb>. Only then: learn the source and look up the destination, as before, inside that VLAN.</p> },
  { id: "tables", chapter: "Inside the switch", title: "One MAC table, split by VLAN.", body: <p>Every entry is <Bb>(VLAN, MAC) → port</Bb>. A frame in VLAN 20 is looked up among VLAN 20 entries only. A switch never forwards a frame from one VLAN into another.</p> },
  { id: "allowed", chapter: "What a trunk carries", title: "A trunk carries only the VLANs it allows.", body: <p>Each end has an <Bb>allowed list</Bb>. Remove VLAN 10 from SW1&apos;s list and SW1 stops putting VLAN 10 frames on the trunk. The link is up, VLAN 20 still crosses, but Sales across floors is cut.</p> },
  { id: "native", chapter: "What a trunk carries", title: "The native VLAN crosses untagged.", body: <p>One VLAN per trunk is sent <Bb>without a tag</Bb>, VLAN 1 by default. An untagged frame arriving on the trunk goes into it. Both ends must agree on which VLAN that is.</p> },
  { id: "mismatch", chapter: "What a trunk carries", title: "Disagree on the native VLAN, and frames change VLAN.", body: <p>SW1&apos;s native is VLAN 10, SW2&apos;s VLAN 1. SW1 sends HOST-A&apos;s frame untagged; SW2 puts it into <Bb>VLAN 1</Bb>. HOST-A&apos;s traffic leaks into the wrong VLAN, and nothing goes “down”. On Cisco, CDP logs a NATIVE_VLAN_MISMATCH. Junos does not.</p> },
  { id: "need-router", chapter: "Between VLANs", title: "Leaving a VLAN takes a router.", body: <p>HOST-A → HOST-C: another subnet, so HOST-A sends to its <Bb>default gateway</Bb> 192.168.10.1. Without a router in VLAN 10, nobody answers, and no switch will bridge the two VLANs.</p> },
  { id: "stick", chapter: "Between VLANs", title: "Router on a stick: one trunk, one subinterface per VLAN.", body: <p>R1 hangs off SW2 on a trunk. <Bb>Gi0/0.10</Bb> accepts VID 10 and owns 192.168.10.1; <Bb>Gi0/0.20</Bb> accepts VID 20 and owns 192.168.20.1. Each subinterface is its VLAN&apos;s gateway. The tag tells R1 which VLAN a frame came from.</p> },
  { id: "hairpin", chapter: "Between VLANs", title: "The hairpin: down to R1 in VID 10, back up in VID 20.", body: <p>The ping goes to R1 tagged 10. R1 routes it: a <Bb>new frame</Bb> with new MACs, TTL 64 → 63, tagged 20, back up the same cable. Then it crosses the SW1↔SW2 trunk again, to HOST-C on SW1, one port from HOST-A.</p> },
  { id: "verify", chapter: "Verify on the devices", title: "Two vendors, the same questions.", body: <p>Which VLAN is each port in? What does each trunk carry, and with which native VLAN? In which VLAN was each MAC learned? Cisco and Junos answer with different commands.</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Follow the VLAN, link by link.", body: <p>Most VLAN failures look the same to users: “I can&apos;t reach X”. The evidence tells them apart.</p> },
  { id: "recap", chapter: "The whole idea", title: "Ports decide, tags carry, routers join.", body: <p>Now watch it in the lesson, then break and fix it in the VLAN Lab.</p> },
];

const VISUAL: Record<Id, string> = { why: "net", split: "net", domain: "net", bcast: "net", hosts: "net", problem: "net", tag: "frame", path: "net", lanes: "net", classify: "classify", tables: "tables", allowed: "net", native: "net", mismatch: "net", "need-router": "net", stick: "net", hairpin: "net", verify: "verify", trouble: "trouble", recap: "recap" };

const C10 = "#22d3ee";
const C20 = "#a78bfa";
const NODES: TopoNode[] = [
  { id: "a", label: "HOST-A", sub: ".10.11", icon: "💻", x: 8, y: 20 },
  { id: "c", label: "HOST-C", sub: ".20.13", icon: "💻", x: 8, y: 76 },
  { id: "sw1", label: "SW1", icon: "⇄", x: 33, y: 48 },
  { id: "sw2", label: "SW2", icon: "⇄", x: 67, y: 48 },
  { id: "b", label: "HOST-B", sub: ".10.12", icon: "💻", x: 92, y: 20 },
  { id: "d", label: "HOST-D", sub: ".20.14", icon: "💻", x: 92, y: 76 },
  { id: "r1", label: "R1", sub: ".10.1 · .20.1", icon: "R", x: 67, y: 90 },
];
const at = (n: string) => nodeAt(NODES, n);
const ROUTER: Id[] = ["stick", "hairpin"];
/** A lane on the SW1↔SW2 trunk (or SW2↔R1): a colored offset line. */
function Lanes({ id }: { id: Id }) {
  const trunk = !["why", "split"].includes(id);
  if (!trunk) return null;
  const lanes: { v: number; c: string; dy: number; dash?: string; broken?: boolean; label?: string }[] = [
    { v: 10, c: C10, dy: -1.6, dash: id === "native" ? "5 3" : undefined, broken: id === "allowed" || id === "mismatch", label: id === "native" ? "10 untagged" : id === "mismatch" ? "10 → lands in VLAN 1" : id === "allowed" ? "10 not allowed on SW1" : undefined },
    { v: 20, c: C20, dy: 1.6 },
  ];
  const vlanColored = !["problem"].includes(id) && trunk;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      {vlanColored && (
        <>
          <line x1="8" y1="20" x2="33" y2="48" stroke={C10} strokeWidth="3" vectorEffect="non-scaling-stroke" />
          <line x1="92" y1="20" x2="67" y2="48" stroke={C10} strokeWidth="3" vectorEffect="non-scaling-stroke" />
          <line x1="8" y1="76" x2="33" y2="48" stroke={C20} strokeWidth="3" vectorEffect="non-scaling-stroke" />
          <line x1="92" y1="76" x2="67" y2="48" stroke={C20} strokeWidth="3" vectorEffect="non-scaling-stroke" />
        </>
      )}
      {lanes.map((l) => (
        <line key={l.v} x1="33" y1={48 + l.dy} x2="67" y2={48 + l.dy} stroke={id === "problem" ? "rgba(148,163,184,0.6)" : l.c} strokeWidth="3" strokeDasharray={l.broken ? "2 3" : l.dash} opacity={l.broken ? 0.55 : 1} vectorEffect="non-scaling-stroke" />
      ))}
      {ROUTER.includes(id) &&
        [
          { c: C10, dx: -1.2 },
          { c: C20, dx: 1.2 },
        ].map((l) => <line key={l.c} x1={67 + l.dx} y1="48" x2={67 + l.dx} y2="90" stroke={l.c} strokeWidth="3" vectorEffect="non-scaling-stroke" />)}
    </svg>
  );
}

function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const id = s.id;
  const k = `${id}-${play}`;
  const head = <StageHead chapter={s.chapter} title={s.title} />;
  const go = (f: string | [number, number], t: string | [number, number], o: { label: string; key: string; delay?: number; stay?: boolean; color?: string; d?: number; dy?: number }) => {
    const off = (p: [number, number]): [number, number] => [p[0], p[1] + (o.dy ?? 0)];
    const from = off(typeof f === "string" ? at(f) : f);
    const to = off(typeof t === "string" ? at(t) : t);
    return (
      <Mover key={`${k}-${o.key}`} from={from} to={o.stay ? short(from, to) : to} delay={o.delay} duration={o.d ?? 700} stay={o.stay}>
        <Token color={o.color ?? "cyan"}>{o.label}</Token>
      </Mover>
    );
  };

  if (VISUAL[id] === "net") {
    const router = ROUTER.includes(id);
    const nodes = router ? NODES : NODES.filter((n) => n.id !== "r1");
    const colored = !["why", "split", "problem"].includes(id);
    const links: TopoLink[] = [
      { a: "a", b: "sw1", label: colored ? "access 10" : "ge-0/0/1", at: 0.45, state: colored ? "dim" : "up" },
      { a: "c", b: "sw1", label: colored ? "access 20" : "ge-0/0/2", at: 0.45, state: colored ? "dim" : "up" },
      { a: "sw1", b: "sw2", label: ["why", "split"].includes(id) ? "uplink" : "trunk ge-0/0/24", state: ["why", "split"].includes(id) ? "up" : "dim" },
      { a: "sw2", b: "b", label: colored ? "access 10" : "ge-0/0/1", at: 0.55, state: colored ? "dim" : "up" },
      { a: "sw2", b: "d", label: colored ? "access 20" : "ge-0/0/2", at: 0.55, state: colored ? "dim" : "up" },
      ...(router ? [{ a: "sw2", b: "r1", label: "trunk 10,20", state: "dim" as const }] : []),
    ];
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "why") {
      movers = (
        <>
          {go("a", "sw1", { label: "FF:FF…", key: "1", color: "amber" })}
          {go("sw1", "c", { label: "FF:FF…", key: "2", delay: 700, stay: true, color: "amber" })}
          {go("sw1", "sw2", { label: "FF:FF…", key: "3", delay: 700, color: "amber" })}
          {go("sw2", "b", { label: "FF:FF…", key: "4", delay: 1400, stay: true, color: "amber" })}
          {go("sw2", "d", { label: "FF:FF…", key: "5", delay: 1400, stay: true, color: "amber" })}
        </>
      );
      views.c = { ring: "hit", bubble: { text: "Sales' broadcast?", tone: "warn", delay: 1200 } };
      views.d = { ring: "hit", bubble: { text: "…me too", tone: "warn", delay: 1900 } };
    }
    if (id === "split") {
      views.sw1 = { badge: { text: "ports → VLANs", tone: "info" } };
      views.sw2 = { badge: { text: "ports → VLANs", tone: "info" } };
    }
    if (id === "domain") {
      views.a = { badge: { text: "VLAN 10", tone: "info" } };
      views.b = { badge: { text: "VLAN 10", tone: "info" } };
      views.c = { badge: { text: "VLAN 20", tone: "warn" } };
      views.d = { badge: { text: "VLAN 20", tone: "warn" } };
    }
    if (id === "bcast") {
      movers = (
        <>
          {go("a", "sw1", { label: "FF:FF…", key: "1" })}
          {go("sw1", "sw2", { label: "VID 10", key: "2", delay: 700, dy: -1.6 })}
          {go("sw2", "b", { label: "FF:FF…", key: "3", delay: 1400, stay: true })}
        </>
      );
      views.c = { ring: "dim", bubble: { text: "never sees it", tone: "no", delay: 800 } };
      views.d = { ring: "dim", bubble: { text: "never sees it", tone: "no", delay: 1500 } };
      views.b = { ring: "target", bubble: { text: "same VLAN → gets it", tone: "yes", delay: 2000 } };
    }
    if (id === "hosts") {
      views.a = { bubble: { text: "eth0: 192.168.10.11 · no VLAN setting", tone: "info" } };
      views.sw1 = { ring: "on", bubble: { text: "ge-0/0/1 = access VLAN 10", tone: "yes", delay: 400 } };
    }
    if (id === "problem") {
      movers = go("sw1", "sw2", { label: "VLAN 10 or 20?", key: "1", color: "white", d: 1200 });
      views.sw2 = { ring: "bad", bubble: { text: "which VLAN is this?", tone: "ask", delay: 1200 } };
    }
    if (id === "path") {
      movers = (
        <>
          {go("a", "sw1", { label: "untagged", key: "1" })}
          {go("sw1", "sw2", { label: "VID 10", key: "2", delay: 700, dy: -1.6 })}
          {go("sw2", "b", { label: "untagged", key: "3", delay: 1400, stay: true })}
        </>
      );
      views.sw1 = { bubble: { text: "add tag 10", tone: "info", delay: 500 } };
      views.sw2 = { bubble: { text: "tag 10 → VLAN 10 · remove tag", tone: "info", delay: 1200 } };
    }
    if (id === "lanes") {
      movers = (
        <>
          {go("sw1", "sw2", { label: "VID 10", key: "1", dy: -1.6, d: 1100 })}
          {go("sw1", "sw2", { label: "VID 20", key: "2", dy: 1.6, d: 1100, delay: 250, color: "violet" })}
        </>
      );
    }
    if (id === "allowed") {
      movers = (
        <>
          {go("a", "sw1", { label: "to B", key: "1" })}
          {go("sw1", "sw2", { label: "VID 10", key: "2", delay: 700, dy: -1.6, stay: true, color: "red" })}
          {go("c", "sw1", { label: "to D", key: "3", delay: 200, color: "violet" })}
          {go("sw1", "sw2", { label: "VID 20", key: "4", delay: 900, dy: 1.6, color: "violet" })}
          {go("sw2", "d", { label: "to D", key: "5", delay: 1600, stay: true, color: "violet" })}
        </>
      );
      views.sw1 = { ring: "bad", bubble: { text: "trunk allows 1,20 → VLAN 10 stops here", tone: "bad", delay: 700 } };
      views.b = { ring: "dim" };
    }
    if (id === "native") {
      movers = (
        <>
          {go("a", "sw1", { label: "untagged", key: "1" })}
          {go("sw1", "sw2", { label: "untagged (native)", key: "2", delay: 700, dy: -1.6 })}
          {go("sw2", "b", { label: "untagged", key: "3", delay: 1400, stay: true })}
        </>
      );
      views.sw1 = { bubble: { text: "native 10 → no tag", tone: "info", delay: 500 } };
      views.sw2 = { bubble: { text: "no tag → my native 10", tone: "yes", delay: 1200 } };
    }
    if (id === "mismatch") {
      movers = (
        <>
          {go("a", "sw1", { label: "untagged", key: "1" })}
          {go("sw1", "sw2", { label: "untagged", key: "2", delay: 700, dy: -1.6, color: "red" })}
        </>
      );
      views.sw1 = { bubble: { text: "native 10 → send untagged", tone: "info", delay: 400 } };
      views.sw2 = { ring: "bad", bubble: { text: "no tag → my native = VLAN 1!", tone: "bad", delay: 1300 } };
      views.b = { ring: "dim", bubble: { text: "never hears HOST-A", tone: "no", delay: 1800 } };
    }
    if (id === "need-router") {
      movers = (
        <>
          {go("a", "sw1", { label: "who has .10.1?", key: "1", color: "amber" })}
          {go("sw1", "sw2", { label: "VID 10", key: "2", delay: 700, dy: -1.6, color: "amber" })}
          {go("sw2", "b", { label: "who has .10.1?", key: "3", delay: 1400, stay: true, color: "amber" })}
        </>
      );
      views.a = { bubble: { text: "C is not in my subnet → gateway", tone: "ask" } };
      views.b = { ring: "dim", bubble: { text: "not me", tone: "no", delay: 2000 } };
      views.c = { ring: "dim" };
    }
    if (id === "stick") {
      views.r1 = { ring: "on", bubble: { text: ".10 ⇐ VID 10 · .20 ⇐ VID 20", tone: "info" } };
    }
    if (id === "hairpin") {
      movers = (
        <>
          {go("a", "sw1", { label: "ping", key: "1", d: 500 })}
          {go("sw1", "sw2", { label: "VID 10", key: "2", delay: 500, dy: -1.6, d: 600 })}
          {go([65.8, 48], [65.8, 90], { label: "VID 10", key: "3", delay: 1100, d: 600 })}
          {go([68.2, 90], [68.2, 48], { label: "VID 20 · TTL 63", key: "4", delay: 1900, d: 600, color: "violet" })}
          {go("sw2", "sw1", { label: "VID 20", key: "5", delay: 2500, dy: 1.6, d: 600, color: "violet" })}
          {go("sw1", "c", { label: "ping", key: "6", delay: 3100, d: 500, stay: true, color: "violet" })}
        </>
      );
      views.r1 = { ring: "on", bubble: { text: "route .10 → .20 · new frame", tone: "yes", delay: 1700 } };
      views.c = { ring: "target", bubble: { text: "TTL 63: it was routed", tone: "yes", delay: 3600 } };
    }
    return (
      <>
        {head}
        <Topo nodes={nodes} links={links} views={views} ratio={router ? 50 : 44} minH={router ? 250 : 230}>
          <Lanes id={id} />
          {movers}
        </Topo>
        {["bcast", "path", "lanes", "allowed", "native", "mismatch", "need-router", "hairpin", "why", "problem"].includes(id) && <ReplayButton onClick={replay} />}
      </>
    );
  }

  switch (id) {
    case "tag":
      return (
        <>
          {head}
          <PacketCard
            layers={[
              {
                name: "Ethernet frame on the trunk",
                color: C10,
                fields: [
                  { k: "Destination MAC", v: "…53:0B" },
                  { k: "Source MAC", v: "…53:0A" },
                  { k: "TPID", v: "0x8100", hi: "new" },
                  { k: "PCP · DEI", v: "0 · 0", hi: "new" },
                  { k: "VID", v: "10", hi: "new" },
                  { k: "EtherType", v: "0x0806 (ARP)" },
                ],
              },
              { name: "Payload (unchanged)", color: "#94a3b8", fields: [{ k: "ARP", v: "who has 192.168.10.12?" }] },
            ]}
          />
          <Compare
            items={[
              { title: "Access port", tone: "cyan", body: "no tag — the port's VLAN is implied" },
              { title: "Trunk", tone: "violet", body: "4 bytes inserted: TPID 0x8100 + 12-bit VID (1–4094)" },
            ]}
          />
        </>
      );
    case "classify":
      return (
        <>
          {head}
          <Chain
            k="cl"
            items={[
              { t: "Frame arrives on a port", tone: "plain" },
              { t: "Access port, untagged → the port's VLAN", tone: "cyan" },
              { t: "Trunk, tagged → the VID (if this trunk allows it, else drop)", tone: "violet" },
              { t: "Trunk, untagged → the native VLAN", tone: "amber" },
              { t: "Learn (VLAN, source MAC) → port", tone: "green" },
              { t: "Look up (VLAN, destination MAC): forward, or flood that VLAN only", tone: "green" },
              { t: "Out a trunk: tag it (unless native) · out an access port: no tag", tone: "plain" },
            ]}
          />
        </>
      );
    case "tables":
      return (
        <>
          {head}
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniTable title="SW1 MAC table" cols={["VLAN", "MAC", "Port"]} rows={[{ cells: ["10", "HOST-A", "ge-0/0/1"] }, { cells: ["10", "HOST-B", "ge-0/0/24 (trunk)"], state: "hit" }, { cells: ["20", "HOST-C", "ge-0/0/2"] }, { cells: ["20", "HOST-D", "ge-0/0/24 (trunk)"], state: "hit" }]} />
            <MiniTable title="SW2 MAC table" cols={["VLAN", "MAC", "Port"]} rows={[{ cells: ["10", "HOST-A", "ge-0/0/24 (trunk)"], state: "hit" }, { cells: ["10", "HOST-B", "ge-0/0/1"] }, { cells: ["20", "HOST-C", "ge-0/0/24 (trunk)"], state: "hit" }, { cells: ["20", "HOST-D", "ge-0/0/2"] }]} />
          </div>
          <Compare items={[{ title: "A trunk port", tone: "violet", body: "appears in every VLAN: hosts of each VLAN live behind it" }, { title: "The lookup", tone: "cyan", body: "only ever in the frame's own VLAN" }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniTable
              title="Cisco IOS"
              cols={["Question", "Command"]}
              rows={[
                { cells: ["VLANs + access ports", "show vlan brief"] },
                { cells: ["Trunks: allowed, native", "show interfaces trunk"] },
                { cells: ["One port's VLAN mode", "show interfaces Gi1/0/1 switchport"] },
                { cells: ["Learned, per VLAN", "show mac address-table vlan 10"] },
                { cells: ["R1 subinterfaces", "show ip interface brief · show vlans"] },
              ]}
            />
            <MiniTable
              title="Junos (EX)"
              cols={["Question", "Command"]}
              rows={[
                { cells: ["VLANs + all members", "show vlans"] },
                { cells: ["Tagged / untagged per port", "show ethernet-switching interface"] },
                { cells: ["One port's config", "show configuration interfaces ge-0/0/24"] },
                { cells: ["Learned, per VLAN", "show ethernet-switching table"] },
                { cells: ["R1 units", "show interfaces terse"] },
              ]}
            />
          </div>
          <Compare items={[{ title: "Cisco", tone: "cyan", body: "show vlan lists ACCESS ports only — trunks are in show interfaces trunk" }, { title: "Junos", tone: "violet", body: "VLANs are named (vlans SALES vlan-id 10) and ports join by name; changes need commit" }]} />
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain
            k="ts"
            items={[
              { t: "Same VLAN, or between VLANs? (same subnet → switches only; else → R1)", tone: "plain" },
              { t: "Is each host's port in the VLAN of its subnet? (show vlan brief / show vlans)", tone: "cyan" },
              { t: "In which VLAN did the switch learn the host's MAC?", tone: "cyan" },
              { t: "Does the trunk allow the VLAN at BOTH ends? Same native VLAN?", tone: "amber" },
              { t: "Between VLANs: does the VLAN reach R1 — and with the VID its subinterface expects?", tone: "violet" },
              { t: "Fix one thing, then prove it with fresh traffic", tone: "green" },
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
              { t: "A VLAN is a broadcast domain the switches create (one subnet each)" },
              { t: "Access ports put untagged host frames into one VLAN", tone: "cyan" },
              { t: "Trunks carry many VLANs with an 802.1Q tag (VID); the native VLAN untagged", tone: "violet" },
              { t: "Learning and lookups happen per VLAN; switches never cross VLANs", tone: "plain" },
              { t: "Allowed lists and native VLANs must match at both ends", tone: "amber" },
              { t: "A router joins VLANs: one subinterface per VID, the hairpin, TTL −1", tone: "green" },
            ]}
          />
        </>
      );
  }
  return head;
}

export function VlanPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="VLANs and trunking, from zero"
      kicker="Learn · the VLAN presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id]}
      renderStage={(s) => <Deck step={s} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
