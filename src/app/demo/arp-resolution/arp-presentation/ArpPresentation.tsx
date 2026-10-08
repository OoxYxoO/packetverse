"use client";

import { useCallback, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { clsx } from "clsx";
import { PracticeLabShell } from "@/components/practice-lab/PracticeLabShell";
import { DeckHeader, DeckNav, Mover, ScrollyDeck, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { ADDR } from "@/lib/sim-engine/scenarios/firstConnection";

/**
 * THE ARP PRESENTATION — "first understand it", before the ARP Lab.
 *
 * A scrollytelling deck (ScrollyDeck): a sticky stage with the network, the frame being built, ARP caches and
 * the switch's MAC table, and short story steps that scroll past it. It starts with the PROBLEM (the frame is
 * missing a destination MAC), resolves it on a local LAN first, then moves to a remote destination on the lab's
 * own network (Laptop · SW1 · R1 · Server, same addresses) so the learner walks straight into the lab.
 *
 * State isolation: this component owns only presentation state (current step, replay counters, what the learner
 * clicked). It never receives the ARP Lab runner, the guided ScenarioEngine or the progress store — scrolling
 * cannot advance the lab, write progress, award XP or complete the lesson.
 */

// ---------------------------------------------------------------------------------------------------------------
// The network (lab addresses for Laptop / R1 / Server; three extra PCs for the local story)
// ---------------------------------------------------------------------------------------------------------------
const LAPTOP = { name: "Laptop", ip: ADDR.laptop.ip, mac: ADDR.laptop.mac };
const PCB = { name: "PC-B", ip: "192.168.10.20", mac: "02:AA:00:00:00:20" };
const PCC = { name: "PC-C", ip: "192.168.10.30", mac: "02:AA:00:00:00:30" };
const PCD = { name: "PC-D", ip: "192.168.10.40", mac: "02:AA:00:00:00:40" };
const R1 = { name: "R1", ip: ADDR.gateway.ip, mac: ADDR.gateway.mac, wanMac: ADDR.routerWan.mac };
const SERVER = { name: "Server", ip: ADDR.server.ip, mac: ADDR.server.mac };
const BCAST = "FF:FF:FF:FF:FF:FF";
const ZERO = "00:00:00:00:00:00";
const UNKNOWN = "?? ?? ?? ?? ?? ??";
const MISSING = "192.168.10.99";

type NodeId = "laptop" | "sw" | "b" | "c" | "d" | "r1" | "server";
const LOCAL_POS: Partial<Record<NodeId, [number, number]>> = { laptop: [13, 50], sw: [45, 50], b: [83, 15], c: [83, 50], d: [83, 85] };
const REMOTE_POS: Partial<Record<NodeId, [number, number]>> = { laptop: [9, 55], sw: [33, 55], r1: [60, 55], server: [90, 55] };

// ---------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------
type StepId =
  | "problem" | "question" | "what" | "stack" | "two-dest" | "local" | "cache" | "req-build" | "req-send"
  | "flood" | "req-fields" | "b-learns" | "reply" | "a-learns" | "frame-done" | "first-later" | "mac-vs-arp"
  | "remote" | "gw-arp" | "ip-vs-mac" | "rebuild" | "table" | "aging" | "fail" | "myths" | "dns" | "recap-local" | "recap-remote";

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;

export const ARP_STEPS: (DeckStep & { id: StepId })[] = [
  { id: "problem", chapter: "The missing MAC", title: "The laptop wants to send data to 192.168.10.20.", body: <p>It knows the destination <B>IP</B>. It starts building the Ethernet frame… and gets stuck on the very first field.</p> },
  { id: "question", chapter: "The missing MAC", title: "Ethernet needs a destination MAC. The laptop only knows the IP.", body: <p>How does it discover the MAC address of 192.168.10.20? <B>That is the problem ARP solves.</B></p> },
  { id: "what", chapter: "What is ARP?", title: "ARP: I know the IP. I need the MAC.", body: <p><B>ARP (Address Resolution Protocol)</B> discovers the Layer-2 MAC address that belongs to an IPv4 address <B>on the local network</B>.</p> },
  { id: "stack", chapter: "Layer 3 vs Layer 2", title: "Data goes into an IP packet, which goes into an Ethernet frame.", body: <p>The application&apos;s data is wrapped in an <B>IP packet</B> (Layer 3), and that packet is carried inside an <B>Ethernet frame</B> (Layer 2).</p> },
  { id: "two-dest", chapter: "Layer 3 vs Layer 2", title: "Two destinations, two jobs.", body: <p>The <B>destination IP</B> says which endpoint we want. The <B>destination MAC</B> says which device on <i>this</i> wire should pick the frame up next. The IP is known; the MAC is not.</p> },
  { id: "local", chapter: "Local delivery", title: "Is 192.168.10.20 on my own network?", body: <p>The laptop is <M>192.168.10.10/24</M>. 192.168.10.20 is in the same /24, so it is <B>local</B>: deliver directly on this LAN. But <i>which</i> device owns .20?</p> },
  { id: "cache", chapter: "Check the ARP cache", title: "First, look in the ARP cache.", body: <p>The laptop keeps a small table of IP → MAC answers it already knows. It&apos;s empty, so no answer yet. (If the entry were there, ARP would be skipped.)</p> },
  { id: "req-build", chapter: "ARP Request", title: "“Who has 192.168.10.20? Tell 192.168.10.10.”", body: <p>The laptop doesn&apos;t know the target&apos;s MAC, so it addresses the request to <B>everyone</B>: Ethernet destination <M>{BCAST}</M>, the broadcast address.</p> },
  { id: "req-send", chapter: "ARP Request", title: "The request leaves the laptop.", body: <p>It travels to the switch like any other frame.</p> },
  { id: "flood", chapter: "Broadcast", title: "The switch floods the broadcast to every port.", body: <p>Every device receives the question. PC-C and PC-D: “not my IP”, so they ignore it. <B>PC-B: “that&apos;s my IP, I&apos;ll answer.”</B> That&apos;s why the request is broadcast: only the owner can recognize its own IP.</p> },
  { id: "req-fields", chapter: "Inside the ARP Request", title: "The four fields that carry the question.", body: <p>Now the fields make sense. Tap each one. The <B>target MAC</B> is all zeros because it is exactly what the laptop is asking for.</p> },
  { id: "b-learns", chapter: "Learning from the request", title: "PC-B learns the laptop's mapping from the request itself.", body: <p>The request already contains the sender&apos;s IP and MAC, so PC-B (the target) stores <M>192.168.10.10 → {LAPTOP.mac}</M>. Now it knows exactly where to answer.</p> },
  { id: "reply", chapter: "ARP Reply", title: "“192.168.10.20 is at 02:AA:00:00:00:20.”", body: <p>PC-B answers <B>only the laptop</B>, so the reply is normally <B>unicast</B>. The request needed broadcast because the laptop knew no MAC; PC-B already learned the laptop&apos;s MAC from the request.</p> },
  { id: "a-learns", chapter: "Cache learning", title: "The laptop learns PC-B's mapping from the reply.", body: <p>Both caches now hold an entry: PC-B learned from the request, the laptop from the reply.</p> },
  { id: "frame-done", chapter: "Cache learning", title: "The frame is complete, and the real traffic leaves.", body: <p>The destination MAC comes from the cache. <B>ARP wasn&apos;t the application traffic. It prepared Layer 2 so the real traffic could be sent.</B></p> },
  { id: "first-later", chapter: "First packet vs later packets", title: "The second time is shorter.", body: <p>Shortly afterwards, the entry is still in the cache: no request, no reply, the data goes straight out. That&apos;s why a capture often shows ARP once, then only data.</p> },
  { id: "mac-vs-arp", chapter: "ARP cache vs switch MAC table", title: "Two tables, two different questions.", body: <p>The <B>host&apos;s ARP cache</B>: which MAC owns this IP? The <B>switch&apos;s MAC table</B>: which port reaches this MAC? The switch doesn&apos;t do ARP for forwarding; it learns source MACs and forwards by port.</p> },
  { id: "remote", chapter: "Remote destination", title: "Now: the Server, 10.20.20.20.", body: <p>This is the lab&apos;s network. Is 10.20.20.20 in <M>192.168.10.0/24</M>? <B>No</B>: it&apos;s remote. The laptop must hand the packet to its <B>default gateway</B>, R1 (192.168.10.1).</p> },
  { id: "gw-arp", chapter: "ARP for the gateway", title: "Does the laptop ARP for 10.20.20.20? No — for its gateway.", body: <p>The frame only needs to reach the <B>next hop</B> on this LAN. So the ARP target is <B>192.168.10.1</B>, the gateway. The broadcast stays inside the LAN; R1 answers with its MAC.</p> },
  { id: "ip-vs-mac", chapter: "IP stays final, MAC is the next hop", title: "MAC → R1. IP → the Server.", body: <p>The <B>destination IP</B> says where the packet ultimately goes (the Server). The <B>destination MAC</B> says where this Ethernet frame goes next (R1).</p> },
  { id: "rebuild", chapter: "IP stays final, MAC is the next hop", title: "R1 builds a new frame for the next hop.", body: <p>R1 strips the old Ethernet frame and builds a new one toward the Server (resolving the Server&apos;s MAC with its own ARP on that segment). The IP destination never changes; the Layer-2 destination changes hop by hop.</p> },
  { id: "table", chapter: "The ARP table", title: "An ARP table grows as the host talks.", body: <p>Tap an entry to see which device it points to and how it was learned.</p> },
  { id: "aging", chapter: "ARP entry aging", title: "Entries don't live forever.", body: <p>An unused entry ages and is eventually removed, then resolved again when needed. <B>How long depends on the operating system or device</B>; there is no single universal timeout.</p> },
  { id: "fail", chapter: "When ARP fails", title: "“Who has 192.168.10.99?” Nobody answers.", body: <p>The host retries, then gives up. Without the next-hop MAC it <B>cannot build the Ethernet frame</B>, so the traffic can&apos;t be delivered. Many systems show the entry as <M>INCOMPLETE</M> (wording varies).</p> },
  { id: "myths", chapter: "Common misconceptions", title: "Five things ARP is not.", body: <p>Tap each card to flip it.</p> },
  { id: "dns", chapter: "DNS vs ARP", title: "DNS: name → IP. ARP: IPv4 → MAC.", body: <p>They answer different questions at different moments. The routing decision sits between them: it picks the next hop that ARP then resolves.</p> },
  { id: "recap-local", chapter: "The whole story", title: "Local destination, start to finish.", body: <p>Every step you just saw, in order.</p> },
  { id: "recap-remote", chapter: "The whole story", title: "Remote destination: ARP for the gateway.", body: <p>Now you&apos;ve seen how ARP works. <B>Next, watch it happen on a real network</B>: the lab is this Laptop, PC-B and PC-C on SW1, and R1 with the Server behind it. Pause any frame, open any device, and prove what each one learned.</p> },
];

const VISUAL: Record<StepId, string> = {
  problem: "frame", question: "frame", what: "what", stack: "stack", "two-dest": "stack",
  local: "lan", cache: "lan", "req-build": "lan", "req-send": "lan", flood: "lan", "req-fields": "fields",
  "b-learns": "lan", reply: "lan", "a-learns": "lan", "frame-done": "lan", "first-later": "first", "mac-vs-arp": "tables",
  remote: "wan", "gw-arp": "wan", "ip-vs-mac": "wan", rebuild: "rebuild", table: "table", aging: "aging", fail: "fail",
  myths: "myths", dns: "dns", "recap-local": "recap", "recap-remote": "recap",
};

// ---------------------------------------------------------------------------------------------------------------
// Visual pieces
// ---------------------------------------------------------------------------------------------------------------
/** Where a token that stays should stop: a little before the node, on the link, so the node stays readable. */
function short(from: [number, number], to: [number, number], d = 16): [number, number] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const k = Math.min(d, len / 2) / len;
  return [to[0] - dx * k, to[1] - dy * k];
}

const TOKEN = {
  req: "bg-pv-warning text-[#1a1200]",
  rep: "bg-pv-success text-[#03140d]",
  data: "bg-pv-cyan text-[#03131a]",
};
function Token({ kind, children }: { kind: keyof typeof TOKEN; children: ReactNode }) {
  return <span className={clsx("block whitespace-nowrap rounded-md px-1.5 py-0.5 pv-mono text-[10px] font-bold shadow-[0_0_14px_rgba(255,255,255,0.35)] sm:text-[12px]", TOKEN[kind])}>{children}</span>;
}

/** The Ethernet frame with what's inside it. */
function Frame({ dst, dstNote, dstTone = "known", src, children, compact }: { dst: string; dstNote?: string; dstTone?: "unknown" | "broadcast" | "known" | "router"; src: string; children?: ReactNode; compact?: boolean }) {
  const tone = { unknown: "border-pv-danger bg-pv-danger/15 text-pv-danger", broadcast: "border-pv-warning bg-pv-warning/15 text-pv-warning", known: "border-pv-success bg-pv-success/15 text-pv-success", router: "border-pv-cyan bg-pv-cyan/15 text-pv-cyan-soft" }[dstTone];
  return (
    <div className={clsx("rounded-2xl border-2 border-sky-400/70 bg-sky-400/[0.06]", compact ? "p-2" : "p-3")}>
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-sky-300">Ethernet frame · Layer 2</p>
      <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
        <div key={dst} className={clsx("pv-pop rounded-lg border-2 px-2 py-1", tone, dstTone === "unknown" && "pv-pulse")}>
          <p className="text-[11px] font-semibold opacity-90">Destination MAC</p>
          <p className="pv-mono text-[14px] font-bold sm:text-[16px]">{dst}</p>
          {dstNote && <p className="text-[11px] opacity-90">{dstNote}</p>}
        </div>
        <div className="rounded-lg border border-pv-border px-2 py-1">
          <p className="text-[11px] text-pv-text-faint">Source MAC</p>
          <p className="pv-mono text-[14px] font-bold text-pv-text sm:text-[16px]">{src}</p>
        </div>
      </div>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}
function IpBox({ src, dst, hiDst, note }: { src: string; dst: string; hiDst?: boolean; note?: string }) {
  return (
    <div className="rounded-xl border-2 border-pv-violet/70 bg-pv-violet/[0.07] p-2">
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-pv-violet">IP packet · Layer 3</p>
      <div className="mt-1 grid grid-cols-2 gap-1.5">
        <div className="rounded-lg border border-pv-border px-2 py-1">
          <p className="text-[11px] text-pv-text-faint">Source IP</p>
          <p className="pv-mono text-[13.5px] font-bold text-pv-text">{src}</p>
        </div>
        <div className={clsx("rounded-lg border px-2 py-1", hiDst ? "border-pv-violet bg-pv-violet/15" : "border-pv-border")}>
          <p className="text-[11px] text-pv-text-faint">Destination IP</p>
          <p className="pv-mono text-[13.5px] font-bold text-pv-text">{dst}</p>
          {note && <p className="text-[11px] text-pv-text-muted">{note}</p>}
        </div>
      </div>
    </div>
  );
}

interface NodeView {
  ring?: "target" | "hit" | "dim" | "on";
  bubble?: { text: string; tone: "ask" | "no" | "yes" | "info"; delay?: number };
}
const NODE_INFO: Record<NodeId, { label: string; ip?: string; mac?: string; icon: string }> = {
  laptop: { label: LAPTOP.name, ip: LAPTOP.ip, mac: LAPTOP.mac, icon: "💻" },
  sw: { label: "Switch", icon: "⇄" },
  b: { label: PCB.name, ip: PCB.ip, mac: PCB.mac, icon: "🖥" },
  c: { label: PCC.name, ip: PCC.ip, mac: PCC.mac, icon: "🖥" },
  d: { label: PCD.name, ip: PCD.ip, mac: PCD.mac, icon: "🖥" },
  r1: { label: "R1 (gateway)", ip: R1.ip, mac: R1.mac, icon: "R" },
  server: { label: SERVER.name, ip: SERVER.ip, mac: SERVER.mac, icon: "🗄" },
};

/** The network: nodes, links, optional travelling tokens and speech bubbles. */
function Net({ pos, views = {}, children, showMac, regions, ratio }: { pos: Partial<Record<NodeId, [number, number]>>; views?: Partial<Record<NodeId, NodeView>>; children?: ReactNode; showMac?: boolean; regions?: boolean; /** height as % of width */ ratio?: number }) {
  const ids = Object.keys(pos) as NodeId[];
  const all: [NodeId, NodeId][] = pos.r1 ? [["laptop", "sw"], ["sw", "r1"], ["r1", "server"]] : pos.sw ? [["laptop", "sw"], ["sw", "b"], ["sw", "c"], ["sw", "d"]] : [["laptop", "b"]];
  const links = all.filter(([a, b]) => pos[a] && pos[b]);
  return (
    <div className="relative w-full" style={{ paddingTop: ratio ? `${ratio}%` : pos.r1 ? "max(36%, 150px)" : "max(48%, 240px)" }}>
      {regions && (
        <>
          <div className="absolute inset-y-[4%] left-0 rounded-2xl border border-dashed border-pv-cyan/40 bg-pv-cyan/[0.04]" style={{ width: "67%" }}>
            <span className="absolute left-2 top-1 text-[10.5px] font-semibold text-pv-cyan-soft sm:text-[12px]">192.168.10.0/24 · this LAN · broadcast domain</span>
          </div>
          <div className="absolute inset-y-[4%] right-0 rounded-2xl border border-dashed border-pv-violet/40 bg-pv-violet/[0.04]" style={{ width: "30%" }}>
            <span className="absolute right-2 top-1 text-[10.5px] font-semibold text-pv-violet sm:text-[12px]">10.20.20.0/24</span>
          </div>
        </>
      )}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {links.map(([a, b]) => (
          <line key={`${a}-${b}`} x1={pos[a]![0]} y1={pos[a]![1]} x2={pos[b]![0]} y2={pos[b]![1]} stroke="rgba(148,163,184,0.45)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {ids.map((id) => {
        const p = pos[id]!;
        const v = views[id] ?? {};
        const info = NODE_INFO[id];
        return (
          <div key={id} className={clsx("absolute z-10 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-500", v.ring === "dim" && "opacity-40")} style={{ left: `${p[0]}%`, top: `${p[1]}%` }}>
            <div className={clsx("flex min-w-[64px] flex-col items-center rounded-xl border-2 bg-pv-bg px-1.5 py-1 text-center leading-tight transition-[border-color,box-shadow] duration-500 sm:min-w-[96px] sm:px-2", v.ring === "target" ? "border-pv-success shadow-[0_0_18px_rgba(52,211,153,0.6)]" : v.ring === "hit" ? "border-pv-warning shadow-[0_0_14px_rgba(251,191,36,0.5)]" : v.ring === "on" ? "border-pv-cyan shadow-[0_0_14px_rgba(34,211,238,0.5)]" : "border-pv-border")}>
              <span className={clsx("text-[15px] sm:text-[19px]", (id === "sw" || id === "r1") && "pv-mono font-bold text-pv-cyan-soft")}>{info.icon}</span>
              <span className="text-[10.5px] font-bold text-pv-text sm:text-[12.5px]">{info.label}</span>
              {info.ip && <span className="pv-mono text-[9px] text-pv-text-muted sm:text-[11px]">{info.ip}</span>}
              {showMac && info.mac && <span className="hidden pv-mono text-[9.5px] text-pv-text-faint sm:block">{info.mac}</span>}
            </div>
            {v.bubble && (
              <span
                className={clsx(
                  "pv-pop absolute bottom-full z-30 mb-1 w-max max-w-[44vw] rounded-lg border px-1.5 py-0.5 text-[10px] font-semibold leading-tight sm:max-w-none sm:whitespace-nowrap sm:text-[12px]",
                  p[0] > 70 ? "right-0" : p[0] < 30 ? "left-0" : "left-1/2 -translate-x-1/2",
                  { ask: "border-pv-warning/60 bg-[#2a2006] text-pv-warning", no: "border-pv-border bg-pv-bg text-pv-text-muted", yes: "border-pv-success/60 bg-[#062417] text-pv-success", info: "border-pv-cyan/60 bg-[#06222a] text-pv-cyan-soft" }[v.bubble.tone],
                )}
                style={{ animationDelay: `${v.bubble.delay ?? 0}ms` }}
              >
                {v.bubble.text}
              </span>
            )}
          </div>
        );
      })}
      {children}
    </div>
  );
}

interface CacheRow {
  ip: string;
  mac: string;
  note?: string;
  state?: "new" | "incomplete" | "searching" | "hit";
}
function CacheTable({ title, rows, empty = "(empty)", pick, onPick, cols = ["IP address", "MAC address"] }: { title: string; rows: CacheRow[]; empty?: string; pick?: string; onPick?: (ip: string) => void; cols?: [string, string] }) {
  return (
    <div className="rounded-xl border border-pv-border bg-pv-bg/70 p-2">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-pv-text-faint">{title}</p>
      <div className="mt-1 grid grid-cols-2 gap-x-2 border-b border-pv-border pb-0.5 text-[10.5px] text-pv-text-faint">
        <span>{cols[0]}</span>
        <span>{cols[1]}</span>
      </div>
      {rows.length === 0 ? (
        <p className="py-1 text-center pv-mono text-[12.5px] text-pv-text-faint">{empty}</p>
      ) : (
        rows.map((r) => (
          <button
            key={r.ip}
            type="button"
            disabled={!onPick}
            onClick={() => onPick?.(r.ip)}
            className={clsx(
              "pv-pop grid w-full grid-cols-2 gap-x-2 rounded py-0.5 text-left pv-mono text-[11.5px] sm:text-[13px]",
              r.state === "new" ? "bg-pv-success/15 text-pv-text" : r.state === "incomplete" ? "bg-pv-danger/10 text-pv-danger" : r.state === "searching" ? "pv-pulse text-pv-warning" : r.state === "hit" ? "bg-pv-cyan/15 text-pv-text" : "text-pv-text",
              pick === r.ip && "ring-2 ring-pv-cyan",
              onPick && "cursor-pointer hover:bg-white/[0.05]",
            )}
          >
            <span>{r.ip}</span>
            <span>
              {r.mac}
              {r.note && <span className="block font-sans text-[10.5px] text-pv-text-muted">{r.note}</span>}
            </span>
          </button>
        ))
      )}
    </div>
  );
}

function Replay({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex justify-center">
      <button type="button" onClick={onClick} className="rounded-full border border-pv-border px-3 py-1 text-[12.5px] font-semibold text-pv-text-muted hover:text-pv-text">
        ↻ Replay
      </button>
    </div>
  );
}

function Chain({ items, k }: { items: { t: string; tone?: "req" | "rep" | "ok" | "warn" }[]; k: string }) {
  return (
    <ol key={k} className="mx-auto w-full max-w-md space-y-0.5">
      {items.map((it, i) => (
        <li key={it.t} className="pv-pop text-center" style={{ animationDelay: `${i * 200}ms` }}>
          {i > 0 && <span className="block text-[11px] leading-none text-pv-text-faint">↓</span>}
          <span className={clsx("inline-block rounded-lg border px-3 py-0.5 text-[13px] font-semibold sm:text-[14.5px]", it.tone === "req" ? "border-pv-warning/60 bg-pv-warning/10 text-pv-text" : it.tone === "rep" ? "border-pv-success/60 bg-pv-success/10 text-pv-text" : it.tone === "ok" ? "border-pv-cyan/60 bg-pv-cyan/10 text-pv-text" : it.tone === "warn" ? "border-pv-violet/60 bg-pv-violet/10 text-pv-text" : "border-pv-border bg-pv-bg/60 text-pv-text")}>
            {it.t}
          </span>
        </li>
      ))}
    </ol>
  );
}

const FIELDS: { k: string; label: string; v: string; why: string }[] = [
  { k: "smac", label: "Sender MAC", v: LAPTOP.mac, why: "Who is asking: the laptop's own MAC. This is what lets PC-B learn the laptop and answer it directly." },
  { k: "sip", label: "Sender IP", v: LAPTOP.ip, why: "The asker's IP: “tell 192.168.10.10”." },
  { k: "tmac", label: "Target MAC", v: ZERO, why: "Unknown, so it's all zeros. This is the answer the laptop is asking for." },
  { k: "tip", label: "Target IP", v: PCB.ip, why: "Who we're looking for: “who has 192.168.10.20?”. Only the device that owns this IP answers." },
];

const MYTHS: { myth: string; fact: ReactNode }[] = [
  { myth: "ARP finds a host anywhere on the Internet.", fact: <>ARP only resolves addresses on the <b>local</b> network: the next hop on this wire.</> },
  { myth: "For a remote server, my PC ARPs for the server.", fact: <>It ARPs for its <b>default gateway</b>. The server&apos;s IP stays in the IP header.</> },
  { myth: "The switch does ARP to forward my frames.", fact: <>Hosts and routers keep <b>IP → MAC</b> (ARP). A switch learns <b>MAC → port</b>.</> },
  { myth: "ARP Request and Reply are both broadcast.", fact: <>The request is broadcast. The reply is normally <b>unicast</b>, straight back to the asker.</> },
  { myth: "ARP replaces DNS.", fact: <>DNS: <b>name → IP</b>. ARP: <b>IPv4 → MAC</b>. Different questions.</> },
];

// ---------------------------------------------------------------------------------------------------------------
// The deck
// ---------------------------------------------------------------------------------------------------------------
function ArpDeck({ step, onStep, goRef, onEnterLab }: { step: number; onStep: (i: number) => void; goRef: MutableRefObject<((i: number) => void) | undefined>; onEnterLab: () => void }) {
  const s = ARP_STEPS[step];
  const id = s.id;
  const [play, setPlay] = useState(0);
  const [field, setField] = useState("tmac");
  const [entry, setEntry] = useState<string | undefined>(R1.ip);
  const [flipped, setFlipped] = useState<Record<number, boolean>>({});
  const [again, setAgain] = useState(false);
  const replay = () => setPlay((p) => p + 1);
  const k = `${id}-${play}`;
  const head = <StageHead chapter={s.chapter} title={s.title} />;
  const at = (n: NodeId) => (LOCAL_POS[n] ?? REMOTE_POS[n])!;
  const atR = (n: NodeId) => REMOTE_POS[n]!;

  const laptopCache: CacheRow[] = ["a-learns", "frame-done"].includes(id) ? [{ ip: PCB.ip, mac: PCB.mac, note: id === "a-learns" ? "learned from the reply" : undefined, state: id === "a-learns" ? "new" : "hit" }] : [];
  const bCache: CacheRow[] = ["b-learns", "reply", "a-learns", "frame-done"].includes(id) ? [{ ip: LAPTOP.ip, mac: LAPTOP.mac, note: id === "b-learns" ? "learned from the request" : undefined, state: id === "b-learns" ? "new" : undefined }] : [];

  const stage = (): ReactNode => {
    switch (id) {
      case "problem":
      case "question":
        return (
          <>
            {head}
            <Net ratio={24} pos={{ laptop: [20, 62], b: [80, 62] }} views={{ laptop: { ring: "on", bubble: { text: "send to 192.168.10.20", tone: "info" } }, b: { ring: "dim" } }} />
            <Frame dst={UNKNOWN} dstTone="unknown" dstNote="unknown, so the frame can't be sent" src={LAPTOP.mac}>
              <IpBox src={LAPTOP.ip} dst={PCB.ip} hiDst note="known ✓" />
            </Frame>
            {id === "question" && <p className="pv-pop text-center text-[18px] font-bold text-pv-text sm:text-[22px]">I know the IP. How do I find the MAC? <span className="text-pv-warning">That&apos;s ARP&apos;s job.</span></p>}
          </>
        );
      case "what":
        return (
          <>
            {head}
            <div className="mx-auto w-full max-w-md space-y-2 text-center">
              <div className="rounded-2xl border-2 border-pv-violet/70 bg-pv-violet/[0.08] p-3">
                <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-pv-violet">IP address · known</p>
                <p className="pv-mono text-[26px] font-bold text-pv-text sm:text-[34px]">{PCB.ip}</p>
              </div>
              <p className="pv-pop text-[20px] font-bold text-pv-warning" style={{ animationDelay: "300ms" }}>
                ↓ ARP ↓
              </p>
              <div className="pv-pop rounded-2xl border-2 border-sky-400/70 bg-sky-400/[0.08] p-3" style={{ animationDelay: "650ms" }}>
                <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-sky-300">MAC address · discovered</p>
                <p className="pv-mono text-[22px] font-bold text-pv-text sm:text-[30px]">{PCB.mac}</p>
              </div>
            </div>
            <p className="text-center text-[16px] font-semibold text-pv-text sm:text-[19px]">“I know the IP. I need the MAC. ARP finds it.”</p>
          </>
        );
      case "stack":
      case "two-dest":
        return (
          <>
            {head}
            {id === "stack" ? (
              <div className="mx-auto w-full max-w-lg space-y-1 text-center">
                {["APPLICATION DATA", "↓ wrapped in", "IP PACKET", "↓ carried in", "ETHERNET FRAME"].map((t, i) => (
                  <p key={t} className={clsx("pv-pop", i % 2 ? "text-[12px] text-pv-text-faint" : "rounded-xl border-2 py-2 text-[15px] font-bold sm:text-[18px]", i === 0 && "border-pv-border text-pv-text", i === 2 && "border-pv-violet/70 text-pv-violet", i === 4 && "border-sky-400/70 text-sky-300")} style={{ animationDelay: `${i * 300}ms` }}>
                    {t}
                  </p>
                ))}
              </div>
            ) : null}
            <Frame dst={id === "two-dest" ? "?" : UNKNOWN} dstTone="unknown" dstNote={id === "two-dest" ? "Layer 2: which device on THIS wire gets the frame next?" : undefined} src={LAPTOP.mac} compact={id === "stack"}>
              <IpBox src={LAPTOP.ip} dst={PCB.ip} hiDst note={id === "two-dest" ? "Layer 3: which endpoint we want ✓" : undefined} />
            </Frame>
            {id === "two-dest" && (
              <div className="pv-pop grid grid-cols-2 gap-2 text-center text-[13px] font-semibold sm:text-[15px]">
                <p className="rounded-xl border border-pv-violet/50 bg-pv-violet/10 p-2 text-pv-text">IP = the logical endpoint</p>
                <p className="rounded-xl border border-sky-400/50 bg-sky-400/10 p-2 text-pv-text">MAC = the next local delivery</p>
              </div>
            )}
          </>
        );
      case "local":
      case "cache":
      case "req-build":
      case "req-send":
      case "flood":
      case "b-learns":
      case "reply":
      case "a-learns":
      case "frame-done": {
        const views: Partial<Record<NodeId, NodeView>> = { laptop: { ring: "on" } };
        let movers: ReactNode = null;
        const flood = id === "flood";
        if (id === "local") views.b = { ring: "dim", bubble: { text: "192.168.10.20 = ?", tone: "ask" } };
        if (id === "req-build") views.laptop = { ring: "on", bubble: { text: "Who has 192.168.10.20? Tell 192.168.10.10", tone: "ask" } };
        if (id === "req-send") movers = <Mover key={k} from={at("laptop")} to={short(at("laptop"), at("sw"))} stay duration={1000}><Token kind="req">ARP ? → FF:FF…</Token></Mover>;
        if (flood) {
          movers = (
            <>
              <Mover key={`${k}-a`} from={at("laptop")} to={at("sw")} duration={800}><Token kind="req">ARP ?</Token></Mover>
              {(["b", "c", "d"] as const).map((n) => (
                <Mover key={`${k}-${n}`} from={at("sw")} to={short(at("sw"), at(n))} delay={800} duration={900} stay><Token kind="req">ARP ?</Token></Mover>
              ))}
            </>
          );
          views.sw = { ring: "hit", bubble: { text: "broadcast → flood", tone: "info", delay: 700 } };
          views.b = { ring: "target", bubble: { text: "That's my IP! I'll answer", tone: "yes", delay: 1800 } };
          views.c = { ring: "hit", bubble: { text: "Not me. Ignore", tone: "no", delay: 1800 } };
          views.d = { ring: "hit", bubble: { text: "Not me. Ignore", tone: "no", delay: 1800 } };
        }
        if (id === "b-learns") views.b = { ring: "target", bubble: { text: "Noted: .10 is 02:AA…:01", tone: "info" } };
        if (id === "reply") {
          views.b = { ring: "target", bubble: { text: "192.168.10.20 is at 02:AA:00:00:00:20", tone: "yes" } };
          views.c = { ring: "dim" };
          views.d = { ring: "dim" };
          movers = (
            <>
              <Mover key={`${k}-1`} from={at("b")} to={at("sw")} duration={900}><Token kind="rep">ARP ✓ → Laptop</Token></Mover>
              <Mover key={`${k}-2`} from={at("sw")} to={short(at("sw"), at("laptop"))} delay={900} duration={900} stay><Token kind="rep">ARP ✓</Token></Mover>
            </>
          );
        }
        if (id === "frame-done") {
          views.b = { ring: "target" };
          views.c = { ring: "dim" };
          views.d = { ring: "dim" };
          movers = (
            <>
              <Mover key={`${k}-1`} from={at("laptop")} to={at("sw")} duration={800}><Token kind="data">DATA</Token></Mover>
              <Mover key={`${k}-2`} from={at("sw")} to={short(at("sw"), at("b"))} delay={800} duration={800} stay><Token kind="data">DATA</Token></Mover>
            </>
          );
        }
        const dstMac = id === "frame-done" ? PCB.mac : ["req-build", "req-send", "flood"].includes(id) ? BCAST : UNKNOWN;
        return (
          <>
            {head}
            <Net pos={LOCAL_POS} views={views} showMac={["b-learns", "reply", "a-learns", "frame-done"].includes(id)}>
              {movers}
            </Net>
            {id === "local" && (
              <div className="pv-pop mx-auto grid w-full max-w-lg grid-cols-1 gap-1 rounded-xl border border-pv-border bg-pv-bg/60 p-2 pv-mono text-[13px] sm:text-[14px]">
                <p>Destination IP = <span className="text-pv-text">192.168.10.20</span></p>
                <p>Same /24 as 192.168.10.10? <b className="text-pv-success">YES → local</b></p>
                <p>Who owns 192.168.10.20? <b className="text-pv-warning">UNKNOWN → ARP</b></p>
              </div>
            )}
            {id === "cache" && (
              <div className="grid gap-2 sm:grid-cols-2">
                <CacheTable title="Laptop ARP cache" rows={[]} />
                <div className="rounded-xl border border-pv-border bg-pv-bg/70 p-2 pv-mono text-[13px]">
                  <p className="text-pv-text">Need 192.168.10.20</p>
                  <p className="pv-pulse text-pv-warning">Cache lookup…</p>
                  <p className="pv-pop font-bold text-pv-danger" style={{ animationDelay: "900ms" }}>No entry found → start ARP</p>
                </div>
              </div>
            )}
            {["req-build", "req-send", "flood"].includes(id) && (
              <Frame dst={BCAST} dstTone="broadcast" dstNote="broadcast: every device on the LAN" src={LAPTOP.mac} compact>
                <p className="rounded-lg border-2 border-pv-warning/60 bg-pv-warning/[0.08] px-2 py-1 text-center text-[13px] font-semibold text-pv-text">ARP Request: “Who has 192.168.10.20? Tell 192.168.10.10.”</p>
              </Frame>
            )}
            {["b-learns", "reply", "a-learns", "frame-done"].includes(id) && (
              <div className="grid gap-2 sm:grid-cols-2">
                <CacheTable title="Laptop ARP cache" rows={laptopCache} />
                <CacheTable title="PC-B ARP cache" rows={bCache} />
              </div>
            )}
            {id === "reply" && (
              <div className="pv-pop grid grid-cols-2 gap-2 text-center">
                <div className="rounded-xl border-2 border-pv-warning/60 bg-pv-warning/10 p-2">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-pv-warning">Request</p>
                  <p className="pv-mono text-[12px] font-bold text-pv-text sm:text-[14px]">{BCAST}</p>
                  <p className="text-[12px] text-pv-text-muted">broadcast: MAC unknown</p>
                </div>
                <div className="rounded-xl border-2 border-pv-success/60 bg-pv-success/10 p-2">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-pv-success">Reply</p>
                  <p className="pv-mono text-[12px] font-bold text-pv-text sm:text-[14px]">{LAPTOP.mac}</p>
                  <p className="text-[12px] text-pv-text-muted">unicast: learned from the request</p>
                </div>
              </div>
            )}
            {id === "frame-done" && (
              <Frame dst={dstMac} dstTone="known" dstNote="from the ARP cache ✓" src={LAPTOP.mac} compact>
                <IpBox src={LAPTOP.ip} dst={PCB.ip} />
              </Frame>
            )}
            {["req-send", "flood", "reply", "frame-done"].includes(id) && <Replay onClick={replay} />}
          </>
        );
      }
      case "req-fields": {
        const f = FIELDS.find((x) => x.k === field)!;
        return (
          <>
            {head}
            <Frame dst={BCAST} dstTone="broadcast" dstNote="Ethernet broadcast" src={LAPTOP.mac}>
              <div className="rounded-xl border-2 border-pv-warning/70 bg-pv-warning/[0.06] p-2">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-pv-warning">ARP Request · inside the frame</p>
                <div className="mt-1 grid grid-cols-2 gap-1.5">
                  {FIELDS.map((x) => (
                    <button key={x.k} type="button" onClick={() => setField(x.k)} className={clsx("rounded-lg border-2 px-2 py-1 text-left", x.k === field ? "border-pv-warning bg-pv-warning/15" : "border-pv-border hover:border-pv-warning/50")}>
                      <p className="text-[11px] text-pv-text-faint">{x.label}</p>
                      <p className="pv-mono text-[12.5px] font-bold text-pv-text sm:text-[14px]">{x.v}</p>
                    </button>
                  ))}
                </div>
              </div>
            </Frame>
            <p key={field} className="pv-pop rounded-xl border border-pv-warning/40 bg-pv-warning/[0.06] p-2 text-center text-[14px] text-pv-text sm:text-[15.5px]">
              <b>{f.label}:</b> {f.why}
            </p>
          </>
        );
      }
      case "first-later":
        return (
          <>
            {head}
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-pv-border bg-pv-bg/60 p-2">
                <p className="mb-1 text-center text-[12px] font-bold uppercase tracking-wide text-pv-text-faint">First packet</p>
                <Chain k={`first-${play}`} items={[{ t: "1 · Check cache: no entry", tone: "warn" }, { t: "2 · ARP Request (broadcast)", tone: "req" }, { t: "3 · ARP Reply (unicast)", tone: "rep" }, { t: "4 · Send the data", tone: "ok" }]} />
              </div>
              <div className={clsx("rounded-xl border p-2 transition-colors", again ? "border-pv-cyan/60 bg-pv-cyan/[0.05]" : "border-pv-border bg-pv-bg/60")}>
                <p className="mb-1 text-center text-[12px] font-bold uppercase tracking-wide text-pv-text-faint">A moment later</p>
                <Chain k={`later-${play}-${again}`} items={[{ t: "1 · Check cache: entry found ✓", tone: "ok" }, { t: "2 · Send the data", tone: "ok" }]} />
              </div>
            </div>
            <CacheTable title="Laptop ARP cache" rows={[{ ip: PCB.ip, mac: PCB.mac, state: again ? "hit" : undefined, note: again ? "used: no ARP needed" : undefined }]} />
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => {
                  setAgain(true);
                  replay();
                }}
                className="rounded-full border border-pv-cyan/60 px-4 py-1.5 text-[14px] font-semibold text-pv-cyan-soft hover:bg-pv-cyan/10"
              >
                Send to 192.168.10.20 again
              </button>
            </div>
          </>
        );
      case "mac-vs-arp":
        return (
          <>
            {head}
            <Net pos={LOCAL_POS} views={{ laptop: { ring: "on", bubble: { text: "ARP cache: .20 → 02:AA…:20", tone: "info" } }, sw: { ring: "hit", bubble: { text: "MAC table: 02:AA…:20 → Fa0/2", tone: "info", delay: 900 } }, b: { ring: "target" }, c: { ring: "dim" }, d: { ring: "dim" } }}>
              <Mover key={`${k}-1`} from={at("laptop")} to={at("sw")} duration={900}><Token kind="data">DATA</Token></Mover>
              <Mover key={`${k}-2`} from={at("sw")} to={short(at("sw"), at("b"))} delay={900} duration={900} stay><Token kind="data">DATA</Token></Mover>
            </Net>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <CacheTable title="Laptop ARP cache" rows={[{ ip: PCB.ip, mac: PCB.mac }]} />
                <p className="text-center text-[13.5px] font-semibold text-pv-text">“Which MAC owns this IP?”</p>
                <p className="text-center text-[12px] text-pv-text-muted">on hosts and routers · IP → MAC</p>
              </div>
              <div className="space-y-1">
                <CacheTable title="Switch MAC table" cols={["MAC address", "Port"]} rows={[{ ip: LAPTOP.mac, mac: "Fa0/1" }, { ip: PCB.mac, mac: "Fa0/2" }]} />
                <p className="text-center text-[13.5px] font-semibold text-pv-text">“Which port reaches this MAC?”</p>
                <p className="text-center text-[12px] text-pv-text-muted">on switches · MAC → port</p>
              </div>
            </div>
            <Replay onClick={replay} />
          </>
        );
      case "remote":
      case "gw-arp":
      case "ip-vs-mac": {
        const views: Partial<Record<NodeId, NodeView>> = { laptop: { ring: "on" } };
        let movers: ReactNode = null;
        if (id === "remote") views.server = { ring: "dim", bubble: { text: "10.20.20.20", tone: "ask" } };
        if (id === "gw-arp") {
          views.r1 = { ring: "target", bubble: { text: "192.168.10.1 is at 02:BB:00:00:00:01", tone: "yes", delay: 1900 } };
          views.server = { ring: "dim" };
          movers = (
            <>
              <Mover key={`${k}-1`} from={atR("laptop")} to={atR("sw")} duration={800}><Token kind="req">Who has 192.168.10.1?</Token></Mover>
              <Mover key={`${k}-2`} from={atR("sw")} to={atR("r1")} delay={800} duration={800}><Token kind="req">ARP ?</Token></Mover>
              <Mover key={`${k}-3`} from={atR("r1")} to={atR("sw")} delay={2000} duration={800}><Token kind="rep">ARP ✓</Token></Mover>
              <Mover key={`${k}-4`} from={atR("sw")} to={short(atR("sw"), atR("laptop"))} delay={2800} duration={800} stay><Token kind="rep">ARP ✓</Token></Mover>
            </>
          );
        }
        if (id === "ip-vs-mac") {
          views.r1 = { ring: "target", bubble: { text: "MAC: this hop", tone: "info" } };
          views.server = { ring: "on", bubble: { text: "IP: final destination", tone: "yes" } };
          movers = (
            <>
              <Mover key={`${k}-1`} from={atR("laptop")} to={atR("sw")} duration={800}><Token kind="data">DATA</Token></Mover>
              <Mover key={`${k}-2`} from={atR("sw")} to={short(atR("sw"), atR("r1"))} delay={800} duration={800} stay><Token kind="data">DATA</Token></Mover>
            </>
          );
        }
        return (
          <>
            {head}
            <Net pos={REMOTE_POS} views={views} regions showMac={id !== "remote"}>
              {movers}
            </Net>
            {id === "remote" && (
              <div className="pv-pop mx-auto grid w-full max-w-lg gap-1 rounded-xl border border-pv-border bg-pv-bg/60 p-2 pv-mono text-[13px] sm:text-[14px]">
                <p>Destination IP = <span className="text-pv-text">10.20.20.20</span></p>
                <p>Same /24 as 192.168.10.10? <b className="text-pv-danger">NO → remote</b></p>
                <p>Next hop = default gateway <b className="text-pv-cyan-soft">192.168.10.1 (R1)</b></p>
              </div>
            )}
            {id === "gw-arp" && (
              <div className="pv-pop grid grid-cols-2 gap-2 text-center">
                <div className="rounded-xl border-2 border-pv-danger/50 bg-pv-danger/[0.06] p-2">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-pv-danger">ARP target?</p>
                  <p className="pv-mono text-[15px] font-bold text-pv-text-muted line-through sm:text-[18px]">10.20.20.20</p>
                  <p className="text-[12px] text-pv-text-muted">not on this LAN: nobody here could answer</p>
                </div>
                <div className="rounded-xl border-2 border-pv-success/60 bg-pv-success/10 p-2">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-pv-success">ARP target ✓</p>
                  <p className="pv-mono text-[15px] font-bold text-pv-text sm:text-[18px]">192.168.10.1</p>
                  <p className="text-[12px] text-pv-text-muted">the gateway: the next hop on this LAN</p>
                </div>
              </div>
            )}
            {id === "ip-vs-mac" && (
              <Frame dst={R1.mac} dstTone="router" dstNote="R1: where this frame goes NEXT" src={LAPTOP.mac} compact>
                <IpBox src={LAPTOP.ip} dst={SERVER.ip} hiDst note="the Server: where the packet ENDS" />
              </Frame>
            )}
            {id !== "remote" && <Replay onClick={replay} />}
          </>
        );
      }
      case "rebuild":
        return (
          <>
            {head}
            <Net pos={REMOTE_POS} views={{ laptop: { ring: "on" }, r1: { ring: "hit", bubble: { text: "new frame", tone: "info", delay: 1700 } }, server: { ring: "target" } }} regions>
              <Mover key={`${k}-1`} from={atR("laptop")} to={atR("sw")} duration={700}><Token kind="data">frame 1</Token></Mover>
              <Mover key={`${k}-2`} from={atR("sw")} to={atR("r1")} delay={700} duration={700}><Token kind="data">frame 1</Token></Mover>
              <Mover key={`${k}-3`} from={atR("r1")} to={short(atR("r1"), atR("server"))} delay={1800} duration={900} stay><Token kind="rep">frame 2</Token></Mover>
            </Net>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <p className="mb-0.5 text-center text-[12px] font-bold text-pv-text-faint">Hop 1 · Laptop → R1</p>
                <Frame dst={R1.mac} dstTone="router" dstNote="R1" src={LAPTOP.mac} compact>
                  <IpBox src={LAPTOP.ip} dst={SERVER.ip} hiDst />
                </Frame>
              </div>
              <div>
                <p className="mb-0.5 text-center text-[12px] font-bold text-pv-text-faint">Hop 2 · R1 → Server</p>
                <Frame dst={SERVER.mac} dstTone="known" dstNote="the Server" src={R1.wanMac} compact>
                  <IpBox src={LAPTOP.ip} dst={SERVER.ip} hiDst />
                </Frame>
              </div>
            </div>
            <p className="text-center text-[14.5px] font-semibold text-pv-text">Same destination IP on both hops. New Ethernet addresses on every hop.</p>
            <Replay onClick={replay} />
          </>
        );
      case "table": {
        const rows: CacheRow[] = [
          { ip: R1.ip, mac: R1.mac, note: "R1, the gateway · learned from R1's ARP Reply" },
          { ip: PCB.ip, mac: PCB.mac, note: "PC-B · learned from PC-B's ARP Reply" },
        ];
        const who: NodeId | undefined = entry === R1.ip ? "r1" : entry === PCB.ip ? "b" : undefined;
        return (
          <>
            {head}
            <div className="relative w-full" style={{ paddingTop: "36%" }}>
              {(
                [
                  ["laptop", 12, 50],
                  ["b", 50, 20],
                  ["r1", 50, 80],
                ] as [NodeId, number, number][]
              ).map(([n, x, y]) => (
                <div key={n} className={clsx("absolute -translate-x-1/2 -translate-y-1/2 rounded-xl border-2 bg-pv-bg px-2 py-1 text-center transition-[border-color,box-shadow] duration-300", who === n ? "border-pv-success shadow-[0_0_18px_rgba(52,211,153,0.6)]" : n === "laptop" ? "border-pv-cyan" : "border-pv-border")} style={{ left: `${x}%`, top: `${y}%` }}>
                  <p className="text-[12.5px] font-bold text-pv-text">{NODE_INFO[n].label}</p>
                  <p className="pv-mono text-[10.5px] text-pv-text-muted">{NODE_INFO[n].ip}</p>
                  <p className="pv-mono text-[10px] text-pv-text-faint">{NODE_INFO[n].mac}</p>
                </div>
              ))}
              {who && (
                <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
                  <line x1={20} y1={50} x2={42} y2={who === "b" ? 22 : 78} stroke="#34d399" strokeWidth={2.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
                </svg>
              )}
            </div>
            <CacheTable title="Laptop ARP cache" rows={rows} pick={entry} onPick={setEntry} />
            <p className="text-center text-[13px] text-pv-text-muted">One entry per neighbor the laptop has talked to on this LAN, never one for the remote Server.</p>
          </>
        );
      }
      case "aging":
        return (
          <>
            {head}
            <div className="mx-auto w-full max-w-md rounded-2xl border border-pv-border bg-pv-bg/70 p-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-pv-text-faint">ARP entry</p>
              <p className="pv-mono text-[16px] font-bold text-pv-text sm:text-[19px]">
                {PCB.ip} → {PCB.mac}
              </p>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-pv-border">
                <div className="pv-bar h-full rounded-full bg-gradient-to-r from-pv-success to-pv-warning" style={{ width: "40%" }} />
              </div>
              <div className="mt-1 flex justify-between text-[11.5px] text-pv-text-muted">
                <span>recently learned</span>
                <span>ages…</span>
                <span>removed</span>
              </div>
            </div>
            <Chain k="age" items={[{ t: "Learned (from a request or reply)", tone: "rep" }, { t: "Used, or confirmed again: kept fresh", tone: "ok" }, { t: "Unused for a while: ages", tone: "warn" }, { t: "Removed → the next packet triggers ARP again", tone: "req" }]} />
            <p className="text-center text-[13px] text-pv-text-muted">Timers differ between operating systems and devices. Check the platform rather than assuming a number.</p>
          </>
        );
      case "fail":
        return (
          <>
            {head}
            <Net pos={LOCAL_POS} views={{ laptop: { ring: "on", bubble: { text: `Who has ${MISSING}?`, tone: "ask" } }, sw: { ring: "hit" }, b: { ring: "hit", bubble: { text: "Not me", tone: "no", delay: 1700 } }, c: { ring: "hit", bubble: { text: "Not me", tone: "no", delay: 1700 } }, d: { ring: "hit", bubble: { text: "Not me", tone: "no", delay: 1700 } } }}>
              {[0, 1].map((r) => (
                <span key={r}>
                  <Mover key={`${k}-${r}-a`} from={at("laptop")} to={at("sw")} delay={r * 2600} duration={700}><Token kind="req">ARP ?{r ? " (retry)" : ""}</Token></Mover>
                  {(["b", "c", "d"] as const).map((n) => (
                    <Mover key={`${k}-${r}-${n}`} from={at("sw")} to={at(n)} delay={r * 2600 + 700} duration={800}><Token kind="req">ARP ?</Token></Mover>
                  ))}
                </span>
              ))}
            </Net>
            <div className="grid gap-2 sm:grid-cols-2">
              <Chain k={`fail-${play}`} items={[{ t: "Request (broadcast)", tone: "req" }, { t: "No reply…", tone: "warn" }, { t: "Retry, wait", tone: "req" }, { t: "Resolution fails", tone: "warn" }]} />
              <div className="space-y-2">
                <CacheTable title="Laptop ARP cache" rows={[{ ip: MISSING, mac: "INCOMPLETE", state: "incomplete", note: "no MAC learned" }]} />
                <Frame dst={UNKNOWN} dstTone="unknown" dstNote="can't be filled: frame not sent" src={LAPTOP.mac} compact />
              </div>
            </div>
            <Replay onClick={replay} />
          </>
        );
      case "myths":
        return (
          <>
            {head}
            <div className="grid gap-2 sm:grid-cols-2">
              {MYTHS.map((m, i) => (
                <button key={m.myth} type="button" onClick={() => setFlipped((f) => ({ ...f, [i]: !f[i] }))} aria-pressed={!!flipped[i]} className={clsx("rounded-xl border-2 p-2.5 text-left transition-colors", flipped[i] ? "border-pv-success/60 bg-pv-success/[0.08]" : "border-pv-danger/50 bg-pv-danger/[0.06] hover:bg-pv-danger/10", i === MYTHS.length - 1 && "sm:col-span-2")}>
                  {flipped[i] ? (
                    <span key="f" className="pv-pop block text-[13.5px] text-pv-text sm:text-[14.5px]">
                      <b className="text-pv-success">✓ Actually: </b>
                      {m.fact}
                    </span>
                  ) : (
                    <span key="m" className="block text-[13.5px] text-pv-text sm:text-[14.5px]">
                      <b className="text-pv-danger">✕ Myth: </b>
                      {m.myth} <span className="text-[11.5px] text-pv-text-faint">(tap)</span>
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        );
      case "dns":
        return (
          <>
            {head}
            <Chain k="dns" items={[{ t: "www.example.com", tone: "ok" }, { t: "DNS: name → IP", tone: "warn" }, { t: "203.0.113.20", tone: "ok" }, { t: "routing decision: remote → next hop", tone: "warn" }, { t: "192.168.10.1 (gateway)", tone: "ok" }, { t: "ARP: IPv4 → MAC", tone: "req" }, { t: R1.mac, tone: "rep" }]} />
            <div className="grid grid-cols-2 gap-2 text-center">
              <p className="rounded-xl border border-pv-violet/50 bg-pv-violet/10 p-2 text-[13px] font-semibold text-pv-text sm:text-[15px]">DNS · name → IP</p>
              <p className="rounded-xl border border-pv-warning/50 bg-pv-warning/10 p-2 text-[13px] font-semibold text-pv-text sm:text-[15px]">ARP · IPv4 → MAC</p>
            </div>
          </>
        );
      case "recap-local":
      case "recap-remote":
        return (
          <>
            {head}
            {id === "recap-local" ? (
              <Chain
                k="rl"
                items={[
                  { t: "Application wants to send" },
                  { t: "Destination IP known" },
                  { t: "Local destination (same subnet)", tone: "ok" },
                  { t: "Check the ARP cache" },
                  { t: "No entry", tone: "warn" },
                  { t: "ARP Request: broadcast", tone: "req" },
                  { t: "Target recognizes its IP", tone: "rep" },
                  { t: "ARP Reply: unicast", tone: "rep" },
                  { t: "Cache learns IP → MAC", tone: "ok" },
                  { t: "Build the Ethernet frame" },
                  { t: "Send the real traffic", tone: "ok" },
                ]}
              />
            ) : (
              <>
                <Chain
                  k="rr"
                  items={[
                    { t: "Application wants a remote IP" },
                    { t: "Destination is remote", tone: "warn" },
                    { t: "Choose the default gateway", tone: "ok" },
                    { t: "ARP for the gateway IP", tone: "req" },
                    { t: "Learn the gateway MAC", tone: "rep" },
                    { t: "Ethernet DST = gateway MAC · IP DST = remote host", tone: "ok" },
                    { t: "Send", tone: "ok" },
                  ]}
                />
                <div className="flex justify-center">
                  <button type="button" onClick={onEnterLab} className="rounded-full bg-pv-cyan px-6 py-3 text-[16px] font-bold text-[#03131a] shadow-[0_0_24px_rgba(34,211,238,0.45)] hover:brightness-110">
                    Explore ARP →
                  </button>
                </div>
              </>
            )}
          </>
        );
    }
  };

  return (
    <ScrollyDeck
      steps={ARP_STEPS}
      step={step}
      onStep={onStep}
      goRef={goRef}
      label="ARP presentation steps"
      visualKey={VISUAL[id]}
      stage={stage()}
      finalAction={
        <button type="button" onClick={onEnterLab} className="rounded-full bg-pv-cyan px-5 py-2 text-[15px] font-bold text-[#03131a] hover:brightness-110">
          Explore ARP →
        </button>
      }
    />
  );
}

/**
 * The presentation as its own full-screen overlay (the same shell the labs use), shown before the ARP Lab.
 * `onEnterLab` closes it and opens the existing lab; the two never share state.
 */
export function ArpPresentationOverlay({ open, onClose, onEnterLab }: { open: boolean; onClose: () => void; onEnterLab: () => void }) {
  const [step, setStep] = useState(0);
  const goRef = useRef<((i: number) => void) | undefined>(undefined);
  const onStep = useCallback((i: number) => setStep(i), []);
  const final = { label: "Explore ARP →", onClick: onEnterLab };
  return (
    <PracticeLabShell
      open={open}
      onClose={onClose}
      title="ARP, from zero"
      sandboxNote="A visual presentation · nothing here changes the lab or your progress"
      onReset={() => goRef.current?.(0)}
      stages={[]}
      currentStage={0}
      loop={{ labels: ["Learn", "Lab", "Practice", "Verify"], current: 0 }}
      primaryAction={(compact) => (compact ? <DeckNav step={step} count={ARP_STEPS.length} goRef={goRef} compact final={final} /> : null)}
      topology={<DeckHeader kicker="Learn · the ARP presentation" steps={ARP_STEPS} step={step} goRef={goRef} skip={{ label: "Skip to the ARP Lab →", onClick: onEnterLab }} final={final} />}
      topologyClassName="h-auto max-w-6xl"
      board={<ArpDeck step={step} onStep={onStep} goRef={goRef} onEnterLab={onEnterLab} />}
    />
  );
}
