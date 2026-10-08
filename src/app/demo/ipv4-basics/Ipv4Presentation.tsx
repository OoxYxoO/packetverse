"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, Lines, MiniTable, PacketCard, Pills, ReplayButton, Token, Topo, nodeAt, short, type TopoNode, type TopoRegion, type TopoView } from "@/components/presentation/Visuals";
import { GATEWAY, INITIAL_TTL, V4_FAULT_PREFIX, V4_IP, V4_MAC, V4_PREFIX, maskOf, networkOf, toBinary } from "@/lib/sim-engine/scenarios/ipv4Basics";

/**
 * IPv4 — the presentation before the lesson/lab, on the lesson's own network (HOST-A — SW-A — R1 — SW-B — HOST-B,
 * two /26 subnets) and its incident (HOST-A's mask mistyped as /24). Every number comes from the lesson's scenario
 * helpers (networkOf, maskOf, toBinary). Presentation state only.
 */

const A = V4_IP["HOST-A"];
const Bip = V4_IP["HOST-B"];
const P = V4_PREFIX;

type Id = "why" | "why-ip" | "address" | "prefix" | "subnets" | "decide" | "two-ways" | "frame" | "to-r1" | "inside-r1" | "ttl" | "new-frame" | "deliver" | "layers" | "fault" | "fault-arp" | "trouble" | "fix" | "recap";
type Step = DeckStep & { id: Id };
const Bb = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;

const STEPS: Step[] = [
  { id: "why", chapter: "Why IP exists", title: "MAC addresses only work inside one LAN.", body: <p>HOST-A and HOST-B are on <Bb>different LANs</Bb>, joined by router R1. A switch can deliver by MAC inside a LAN, but nothing on LAN-A knows or reaches HOST-B&apos;s MAC.</p> },
  { id: "why-ip", chapter: "Why IP exists", title: "IP gives every device an address that says which network it's on.", body: <p>An IPv4 address has a <Bb>network part</Bb> (which LAN) and a <Bb>host part</Bb> (which device). Routers forward by the network part, so a packet can cross from one LAN to another.</p> },
  { id: "address", chapter: "The IPv4 address", title: `HOST-A is ${A}/${P}.`, body: <p>Four octets, 32 bits. The <M>/{P}</M> is the prefix: how many leading bits are the network part.</p> },
  { id: "prefix", chapter: "The IPv4 address", title: "The mask keeps the network bits and clears the host bits.", body: <p>/{P} = <M>{maskOf(P)}</M>. Address AND mask = the <Bb>network address</Bb>: {A} AND {maskOf(P)} = <M>{networkOf(A, P)}</M>.</p> },
  { id: "subnets", chapter: "Two subnets", title: "This network is two /26 subnets.", body: <p>LAN-A is <M>192.168.10.0/26</M> (.0–.63). LAN-B is <M>192.168.10.64/26</M> (.64–.127). R1 has one interface in each: <M>{V4_IP.R1L}</M> and <M>{V4_IP.R1R}</M>.</p> },
  { id: "decide", chapter: "The host's decision", title: "First question: is the destination on my subnet?", body: <p>HOST-A ANDs <Bb>its own address and the destination</Bb> with <Bb>its own mask</Bb>. {A} → {networkOf(A, P)}. {Bip} → {networkOf(Bip, P)}. Different networks, so HOST-B is <Bb>remote</Bb>.</p> },
  { id: "two-ways", chapter: "The host's decision", title: "Local → deliver directly. Remote → hand it to the gateway.", body: <p>For a remote destination the host sends the frame to its <Bb>default gateway</Bb> (R1, {GATEWAY["HOST-A"]}), which must itself be on the local subnet.</p> },
  { id: "frame", chapter: "Building the packet", title: "IP destination = HOST-B. Ethernet destination = R1.", body: <p>The IP header says where the packet <Bb>ends</Bb> ({Bip}). The Ethernet frame says where it goes <Bb>next</Bb>: R1&apos;s MAC (from ARP, the previous lesson). TTL starts at {INITIAL_TTL}.</p> },
  { id: "to-r1", chapter: "Hop 1", title: "The frame crosses LAN-A to R1.", body: <p>SW-A forwards it by MAC to R1&apos;s ge-0/0/0. The switch doesn&apos;t look at the IP header at all.</p> },
  { id: "inside-r1", chapter: "Inside R1", title: "R1 removes the frame and reads the destination IP.", body: <p>The frame was addressed to R1, so R1 accepts it, strips the Ethernet header, and looks up {Bip} in its <Bb>routing table</Bb>: it matches the connected 192.168.10.64/26 on ge-0/0/1.</p> },
  { id: "ttl", chapter: "Inside R1", title: `TTL ${INITIAL_TTL} → ${INITIAL_TTL - 1}, checksum recomputed.`, body: <p>Every router decrements TTL (a loop guard: at 0 the packet is dropped) and recalculates the header checksum because the header changed. <Bb>Source and destination IP don&apos;t change.</Bb></p> },
  { id: "new-frame", chapter: "Hop 2", title: "R1 builds a brand-new frame for LAN-B.", body: <p>New source MAC (R1 ge-0/0/1), new destination MAC (HOST-B). Same IP packet inside. Layer 2 is rebuilt at every router.</p> },
  { id: "deliver", chapter: "Hop 2", title: "HOST-B receives it. The reply works the same way back.", body: <p>HOST-B sees {A} is remote too, so it sends the reply to <Bb>its</Bb> gateway, {GATEWAY["HOST-B"]}.</p> },
  { id: "layers", chapter: "The big idea", title: "Layer 2 changes per hop. Layer 3 doesn't.", body: <p>The MAC addresses describe <Bb>this link</Bb>. The IP addresses describe <Bb>the whole journey</Bb>.</p> },
  { id: "fault", chapter: "The incident", title: `Ticket: “HOST-A can't reach HOST-B.” HOST-A's mask was typed as /${V4_FAULT_PREFIX}.`, body: <p>Redo HOST-A&apos;s test with <M>/{V4_FAULT_PREFIX}</M>: {A} → {networkOf(A, V4_FAULT_PREFIX)}, {Bip} → {networkOf(Bip, V4_FAULT_PREFIX)}. <Bb>Same network!</Bb> HOST-A now believes HOST-B is local.</p> },
  { id: "fault-arp", chapter: "The incident", title: "So HOST-A ARPs for HOST-B directly, and nobody answers.", body: <p>The ARP broadcast stays on LAN-A. HOST-B is on LAN-B and never hears it; R1 doesn&apos;t answer for other hosts (no Proxy ARP). HOST-A can&apos;t build a frame, so nothing is sent.</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Evidence, not guesses.", body: <p>The router saw nothing, local hosts still work, and the ARP entry for {Bip} is incomplete. Compare HOST-A&apos;s mask with the subnet plan.</p> },
  { id: "fix", chapter: "Troubleshooting", title: "Restore /26, then prove it.", body: <p>With the right mask, {Bip} is remote again: the frame goes to R1&apos;s MAC, R1 routes it, HOST-B replies. Verify with a ping and check that HOST-A&apos;s ARP cache holds the gateway, not HOST-B.</p> },
  { id: "recap", chapter: "The whole idea", title: "Mask → local or remote → next hop → new frame per hop.", body: <p>Now follow the same packet in the lesson, hop by hop, and repair the mask yourself.</p> },
];

const VISUAL: Record<Id, string> = {
  why: "net", "why-ip": "net", address: "bits", prefix: "bits", subnets: "subnets", decide: "and", "two-ways": "two", frame: "frame", "to-r1": "net", "inside-r1": "r1", ttl: "r1", "new-frame": "hops", deliver: "net", layers: "hops", fault: "and", "fault-arp": "net", trouble: "trouble", fix: "net", recap: "recap",
};

const NODES: TopoNode[] = [
  { id: "a", label: "HOST-A", sub: A, sub2: V4_MAC["HOST-A"], icon: "💻", x: 8, y: 58 },
  { id: "swa", label: "SW-A", icon: "⇄", x: 28, y: 58 },
  { id: "r1", label: "R1", sub: ".1 | .65", icon: "R", x: 50, y: 58 },
  { id: "swb", label: "SW-B", icon: "⇄", x: 72, y: 58 },
  { id: "b", label: "HOST-B", sub: Bip, sub2: V4_MAC["HOST-B"], icon: "💻", x: 92, y: 58 },
];
const LINKS = [
  { a: "a", b: "swa" },
  { a: "swa", b: "r1", label: "ge-0/0/0" },
  { a: "r1", b: "swb", label: "ge-0/0/1" },
  { a: "swb", b: "b" },
];
const REGIONS: TopoRegion[] = [
  { x: 0, y: 8, w: 49, h: 84, label: "LAN-A · 192.168.10.0/26", color: "#22d3ee" },
  { x: 51, y: 8, w: 49, h: 84, label: "LAN-B · 192.168.10.64/26", color: "#a78bfa" },
];
const at = (n: string) => nodeAt(NODES, n);

function Bits({ ip, prefix, label }: { ip: string; prefix: number; label: string }) {
  const bits = toBinary(ip).replace(/\./g, "");
  return (
    <div className="space-y-0.5">
      <p className="text-[11.5px] font-semibold text-pv-text-muted">{label}</p>
      <div className="grid gap-px" style={{ gridTemplateColumns: "repeat(32, minmax(0,1fr))" }}>
        {bits.split("").map((b, i) => (
          <span key={i} className="relative flex h-6 items-center justify-center rounded-[2px] pv-mono text-[9px] font-bold sm:text-[11px]" style={{ background: i < prefix ? "rgba(167,139,250,0.35)" : "rgba(52,211,153,0.18)", color: i < prefix ? "#ddd6fe" : "#bbf7d0", marginLeft: i % 8 === 0 && i ? 3 : 0 }}>
            {b}
            {i === prefix && <span className="absolute -inset-y-1 -left-[2px] w-[3px] rounded bg-white" />}
          </span>
        ))}
      </div>
    </div>
  );
}

function Ipv4Deck({ step: s, play, replay, mode, setMode }: { step: Step; play: number; replay: () => void; mode: "local" | "remote"; setMode: (m: "local" | "remote") => void }) {
  const id = s.id;
  const k = `${id}-${play}`;
  const head = <StageHead chapter={s.chapter} title={s.title} />;
  const go = (f: string, t: string, o: { label: string; key: string; delay?: number; stay?: boolean; color?: string; d?: number }) => (
    <Mover key={`${k}-${o.key}`} from={at(f)} to={o.stay ? short(at(f), at(t)) : at(t)} delay={o.delay} duration={o.d ?? 800} stay={o.stay}>
      <Token color={o.color ?? "cyan"}>{o.label}</Token>
    </Mover>
  );

  if (VISUAL[id] === "net") {
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "why") {
      views.a = { ring: "on", bubble: { text: "HOST-B's MAC? not on my LAN", tone: "ask" } };
      views.r1 = { ring: "hit", bubble: { text: "two networks", tone: "info" } };
    }
    if (id === "why-ip") {
      views.a = { ring: "on", badge: { text: "net .0/26", tone: "info" } };
      views.b = { ring: "target", badge: { text: "net .64/26", tone: "warn" } };
    }
    if (id === "to-r1") {
      movers = (
        <>
          {go("a", "swa", { label: "R1 MAC", key: "1", d: 700 })}
          {go("swa", "r1", { label: "R1 MAC", key: "2", delay: 700, stay: true })}
        </>
      );
      views.swa = { ring: "on", bubble: { text: "forward by MAC", tone: "info", delay: 500 } };
    }
    if (id === "deliver") {
      movers = (
        <>
          {go("r1", "swb", { label: "B MAC", key: "1", d: 700, color: "green" })}
          {go("swb", "b", { label: "B MAC", key: "2", delay: 700, stay: true, color: "green" })}
          {go("b", "swb", { label: "reply → R1 .65", key: "3", delay: 1800, d: 700, color: "violet" })}
          {go("swb", "r1", { label: "reply", key: "4", delay: 2500, stay: true, color: "violet" })}
        </>
      );
      views.b = { ring: "target", bubble: { text: `${A} is remote → my gateway .65`, tone: "yes", delay: 1500 } };
    }
    if (id === "fault-arp") {
      movers = (
        <>
          {go("a", "swa", { label: `ARP: who has ${Bip}?`, key: "1", d: 800, color: "amber" })}
          {go("swa", "r1", { label: "ARP ?", key: "2", delay: 800, stay: true, color: "amber" })}
        </>
      );
      views.a = { ring: "bad", bubble: { text: "thinks HOST-B is local", tone: "bad" } };
      views.r1 = { ring: "hit", bubble: { text: "not my address → no reply", tone: "no", delay: 1700 } };
      views.b = { ring: "dim", bubble: { text: "never hears it", tone: "no", delay: 1700 } };
    }
    if (id === "fix") {
      movers = (
        <>
          {go("a", "swa", { label: "→ R1", key: "1", d: 600 })}
          {go("swa", "r1", { label: "→ R1", key: "2", delay: 600, d: 600 })}
          {go("r1", "swb", { label: "→ B", key: "3", delay: 1300, d: 600, color: "green" })}
          {go("swb", "b", { label: "→ B", key: "4", delay: 1900, stay: true, color: "green" })}
        </>
      );
      views.a = { ring: "on", badge: { text: `/${P} ✓`, tone: "yes" } };
      views.b = { ring: "target", bubble: { text: "ping reply ✓", tone: "yes", delay: 2500 } };
    }
    const animated = ["to-r1", "deliver", "fault-arp", "fix"].includes(id);
    return (
      <>
        {head}
        <Topo nodes={NODES} links={LINKS} regions={REGIONS} views={views} ratio={34} minH={200}>
          {movers}
        </Topo>
        {id === "fault-arp" && <MiniTable title="HOST-A ARP cache" cols={["IP", "MAC"]} rows={[{ cells: [Bip, "INCOMPLETE"], state: "bad", note: "no reply: the frame can't be built" }]} />}
        {animated && <ReplayButton onClick={replay} />}
      </>
    );
  }

  switch (id) {
    case "address":
    case "prefix":
      return (
        <>
          {head}
          <p className="text-center pv-mono text-[26px] font-bold sm:text-[36px]">
            <span style={{ color: "#c4b5fd" }}>{A}</span>
            <span className="text-pv-text-faint">/{P}</span>
          </p>
          <Bits ip={A} prefix={P} label={`${A} · ${P} network bits | ${32 - P} host bits`} />
          {id === "prefix" && (
            <>
              <Bits ip={maskOf(P)} prefix={P} label={`mask ${maskOf(P)} · 1 = keep, 0 = clear`} />
              <Bits ip={networkOf(A, P)} prefix={P} label={`AND → network ${networkOf(A, P)}`} />
            </>
          )}
        </>
      );
    case "subnets": {
      const blocks = [0, 64, 128, 192];
      return (
        <>
          {head}
          <div className="flex h-24 gap-1">
            {blocks.map((b, i) => (
              <div key={b} className="flex flex-1 flex-col items-center justify-center rounded-lg border-2 text-center" style={{ borderColor: i === 0 ? "#22d3ee" : i === 1 ? "#a78bfa" : "rgba(148,163,184,0.3)", background: i === 0 ? "rgba(34,211,238,0.15)" : i === 1 ? "rgba(167,139,250,0.15)" : "transparent" }}>
                <span className="pv-mono text-[11.5px] font-bold text-pv-text sm:text-[13.5px]">.{b}/26</span>
                <span className="pv-mono text-[10px] text-pv-text-muted sm:text-[11.5px]">
                  .{b}–.{b + 63}
                </span>
                <span className="text-[10.5px] text-pv-text-muted">{i === 0 ? "LAN-A" : i === 1 ? "LAN-B" : "unused"}</span>
              </div>
            ))}
          </div>
          <Compare
            items={[
              { title: "LAN-A", tone: "cyan", body: <>HOST-A {A}<br />R1 ge-0/0/0 {V4_IP.R1L}</> },
              { title: "LAN-B", tone: "violet", body: <>HOST-B {Bip}<br />R1 ge-0/0/1 {V4_IP.R1R}</> },
            ]}
          />
        </>
      );
    }
    case "decide":
    case "fault": {
      const p = id === "fault" ? V4_FAULT_PREFIX : P;
      const same = networkOf(A, p) === networkOf(Bip, p);
      return (
        <>
          {head}
          <div className="mx-auto w-full max-w-lg rounded-2xl border border-pv-border bg-pv-bg/60 p-3 pv-mono text-[13.5px] sm:text-[15px]">
            <p>HOST-A uses ITS mask: <b className={id === "fault" ? "text-pv-danger" : "text-pv-text"}>/{p} = {maskOf(p)}</b></p>
            <p className="mt-1">
              {A} AND mask = <b className="text-pv-text">{networkOf(A, p)}</b>
            </p>
            <p>
              {Bip} AND mask = <b className="text-pv-text">{networkOf(Bip, p)}</b>
            </p>
            <p key={p} className={`pv-pop mt-2 text-[16px] font-bold sm:text-[18px] ${same ? (id === "fault" ? "text-pv-danger" : "text-pv-success") : "text-pv-warning"}`}>
              {same ? "SAME network → “local”: ARP for HOST-B directly" : "DIFFERENT networks → remote: send to the gateway"}
            </p>
          </div>
          {id === "fault" && <Compare items={[{ title: "Correct /26", tone: "green", body: `.10 → .0 · .70 → .64 → remote` }, { title: "Mistyped /24", tone: "red", body: `.10 → .0 · .70 → .0 → “local” (wrong)` }]} />}
        </>
      );
    }
    case "two-ways":
      return (
        <>
          {head}
          <Pills label="Destination" options={[{ v: "local", label: "Destination on my subnet" }, { v: "remote", label: "Destination remote" }]} value={mode} onPick={setMode} />
          <Compare
            items={
              mode === "local"
                ? [{ title: "Local", tone: "green", body: <>ARP for <b className="text-pv-text">the destination itself</b><br />Ethernet dst = destination&apos;s MAC<br />no router involved</> }]
                : [{ title: "Remote", tone: "amber", body: <>ARP for <b className="text-pv-text">the default gateway</b><br />Ethernet dst = gateway&apos;s MAC<br />IP dst = the remote host, unchanged</> }]
            }
          />
          <p className="text-center text-[13.5px] text-pv-text-muted">The gateway must be on the host&apos;s own subnet, or the host couldn&apos;t reach it either.</p>
        </>
      );
    case "frame":
      return (
        <>
          {head}
          <PacketCard
            layers={[
              { name: "Ethernet · hop 1", color: "#94a3b8", fields: [{ k: "Dst MAC", v: `${V4_MAC.R1L} (R1)`, hi: "key" }, { k: "Src MAC", v: V4_MAC["HOST-A"] }, { k: "EtherType", v: "0x0800" }] },
              { name: "IPv4 · end to end", color: "#a78bfa", fields: [{ k: "Src IP", v: A }, { k: "Dst IP", v: `${Bip} (HOST-B)`, hi: "key" }, { k: "TTL", v: INITIAL_TTL }, { k: "Protocol", v: "17 (UDP)" }, { k: "Checksum", v: "computed" }] },
            ]}
          />
        </>
      );
    case "inside-r1":
    case "ttl":
      return (
        <>
          {head}
          <Chain k="r1" horizontal items={[{ t: "frame for my MAC → accept", tone: "cyan" }, { t: "strip Ethernet", tone: "plain" }, { t: `look up ${Bip}`, tone: "violet" }, { t: "TTL −1, new checksum", tone: "amber" }, { t: "new frame out ge-0/0/1", tone: "green" }]} />
          <MiniTable title="R1 routing table" cols={["Prefix", "Interface", "Source"]} rows={[{ cells: ["192.168.10.0/26", "ge-0/0/0", "connected"] }, { cells: ["192.168.10.64/26", "ge-0/0/1", "connected"], state: "best", note: `${Bip} matches → ge-0/0/1` }]} />
          {id === "ttl" && (
            <PacketCard layers={[{ name: "IPv4 header after R1", color: "#a78bfa", fields: [{ k: "Src IP", v: A }, { k: "Dst IP", v: Bip }, { k: "TTL", v: `${INITIAL_TTL} → ${INITIAL_TTL - 1}`, hi: "new" }, { k: "Checksum", v: "recomputed", hi: "new" }] }]} />
          )}
        </>
      );
    case "new-frame":
    case "layers":
      return (
        <>
          {head}
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <p className="mb-0.5 text-center text-[12px] font-bold text-pv-text-faint">Hop 1 · LAN-A</p>
              <PacketCard compact layers={[{ name: "Ethernet", color: "#94a3b8", fields: [{ k: "Dst MAC", v: "R1 ge-0/0/0" }, { k: "Src MAC", v: "HOST-A" }] }, { name: "IPv4", color: "#a78bfa", fields: [{ k: "Src", v: A }, { k: "Dst", v: Bip }, { k: "TTL", v: INITIAL_TTL }] }]} />
            </div>
            <div>
              <p className="mb-0.5 text-center text-[12px] font-bold text-pv-text-faint">Hop 2 · LAN-B</p>
              <PacketCard compact layers={[{ name: "Ethernet (new)", color: "#94a3b8", fields: [{ k: "Dst MAC", v: "HOST-B", hi: "new" }, { k: "Src MAC", v: "R1 ge-0/0/1", hi: "new" }] }, { name: "IPv4 (same)", color: "#a78bfa", fields: [{ k: "Src", v: A }, { k: "Dst", v: Bip }, { k: "TTL", v: INITIAL_TTL - 1, hi: "new" }] }]} />
            </div>
          </div>
          {id === "layers" && <Lines k="lay" mono={false} lines={["MAC addresses: this link only", "IP addresses: the whole journey"]} />}
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain
            k="ts"
            items={[
              { t: `Symptom: HOST-A can't reach ${Bip}`, tone: "red" },
              { t: "Observe: HOST-A still reaches devices on LAN-A", tone: "plain" },
              { t: `Evidence: ARP entry for ${Bip} = INCOMPLETE`, tone: "amber" },
              { t: "Evidence: R1 receives no frames from HOST-A for it", tone: "amber" },
              { t: `Evidence: HOST-A mask = ${maskOf(V4_FAULT_PREFIX)}`, tone: "amber" },
              { t: `Hypothesis: wrong mask makes .70 look local`, tone: "violet" },
              { t: `Root cause: /${V4_FAULT_PREFIX} instead of /${P}`, tone: "violet" },
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
              { t: "Destination IP known" },
              { t: "AND both addresses with MY mask", tone: "violet" },
              { t: "Same network → deliver directly", tone: "green" },
              { t: "Different → send to my default gateway", tone: "amber" },
              { t: "Router: lookup, TTL −1, new frame", tone: "cyan" },
              { t: "IP stays the same; MACs change every hop", tone: "plain" },
              { t: "Wrong mask → wrong decision → no traffic", tone: "red" },
            ]}
          />
        </>
      );
  }
  return head;
}

export function Ipv4Presentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  const [mode, setMode] = useState<"local" | "remote">("remote");
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="IPv4, from zero"
      kicker="Learn · the IPv4 presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id]}
      renderStage={(s) => <Ipv4Deck step={s} play={play} replay={() => setPlay((p) => p + 1)} mode={mode} setMode={setMode} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
