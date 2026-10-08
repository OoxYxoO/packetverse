"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { clsx } from "clsx";
import { SEGMENTS } from "@/lib/sim-engine/scenarios/subnettingDesign";
import { PracticeLabShell } from "@/components/practice-lab/PracticeLabShell";
import { DeckHeader, DeckNav, ScrollyDeck, StageHead } from "@/components/presentation/ScrollyDeck";
import { slMinPrefix } from "@/lib/sim-engine/scenarios/subnettingLab";
import { SEG_COLOR } from "./SubnetRuler";
import { AddressGrid, type CellView } from "./SubnetGrid";
import { BitBar, ChainStrip, FullBits, MOTION_CSS, alpha, blank, paint, useStepper } from "./SubnetKit";
import { DEPTS, MIXED, type Dept } from "./SubnetStart";
import { segName } from "./SubnetVisuals";

/**
 * THE SUBNETTING PRESENTATION — the "first understand it" part, before the Subnet Explorer.
 *
 * A scrollytelling deck: a sticky visual STAGE (one persistent address-space bar that physically divides, bit
 * strips whose network|host line moves, company devices that regroup into subnets, a class chart, block zooms)
 * and short narrative STEPS that scroll past it. Each step sets the stage; the learner can also interact with the
 * stage (split buttons, prefix slider, play/pause, tap bits/blocks). Laid out by the shared ScrollyDeck: Prev/Next, the
 * keyboard and step cards move step by step. Ends with the full mental-model chain and "Explore it yourself →".
 *
 * Every number is plain bit arithmetic or comes from the lab model's helpers; nothing is graded or recorded.
 */

const CLASH = "repeating-linear-gradient(135deg, rgba(248,113,113,0.95) 0 3px, rgba(248,113,113,0.25) 3px 7px)";
const fmt = (n: number) => n.toLocaleString("en-US");
const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const pow = (b: number) => `2${String(b).split("").map((d) => SUP[Number(d)]).join("")}`;

// =============================================================================================================
// Steps (the narrative)
// =============================================================================================================
type StepId =
  | "intro" | "what" | "split26" | "split27"
  | "why-one" | "why-split" | "why-list"
  | "ipv4" | "octets" | "binary" | "nethost" | "slash24"
  | "mask24" | "mask26" | "slider"
  | "eq-addr" | "eq-usable" | "eq-subnets"
  | "classes" | "cidr"
  | "netaddr" | "bcast" | "bounds"
  | "flsm" | "vlsm"
  | "design-req" | "design-place" | "design-verify" | "summary";

interface Step {
  id: StepId;
  chapter: string;
  title: string;
  body: ReactNode;
}
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;

export const STEPS: Step[] = [
  { id: "intro", chapter: "What is subnetting?", title: "One network. 256 addresses.", body: <p>This bar is <B>10.44.0.0/24</B>: one IP network. Every address in it lives somewhere along the bar.</p> },
  { id: "what", chapter: "What is subnetting?", title: "Subnetting = dividing one IP network into smaller IP networks.", body: <p>Cut the bar in half: two networks, <B>10.44.0.0/25</B> and <B>10.44.0.128/25</B>, with 128 addresses each. Nothing new was created; the same 256 were divided.</p> },
  { id: "split26", chapter: "What is subnetting?", title: "Split again: four /26 networks.", body: <p>Each half splits in two. Four networks of <B>64</B>. Still 256 in total.</p> },
  { id: "split27", chapter: "What is subnetting?", title: "And again: eight /27 networks.", body: <p>Eight networks of <B>32</B>. Try the split buttons under the bar to divide it yourself.</p> },
  { id: "why-one", chapter: "Why do we subnet?", title: "A company with one big network.", body: <p>Sales 40, IT 20, Cameras 12, Servers 8 devices, all on the same network. Press <B>📣 broadcast</B>: a camera&apos;s broadcast reaches <i>everyone</i>.</p> },
  { id: "why-split", chapter: "Why do we subnet?", title: "Give each team its own subnet.", body: <p>Same devices, same /24, now four networks joined by a <B>router</B>. Broadcast again: it stays inside the cameras&apos; subnet.</p> },
  { id: "why-list", chapter: "Why do we subnet?", title: "What subnetting buys you.", body: <p>Organized addresses, separated groups, smaller broadcast domains, a router where security rules live, and blocks sized to real needs. Easier to design, easier to manage.</p> },
  { id: "ipv4", chapter: "What is an IPv4 address?", title: "The thing we divide: an IPv4 address.", body: <p>It looks like four numbers. Underneath, it is <B>32 bits</B>.</p> },
  { id: "octets", chapter: "What is an IPv4 address?", title: "Four numbers, 8 bits each.", body: <p>Each number (an <B>octet</B>) is 8 bits, so it can be 0–255. 4 × 8 = 32.</p> },
  { id: "binary", chapter: "What is an IPv4 address?", title: "The same address, in bits.", body: <p>No need to convert by hand. Just see it: <B>an IPv4 address is 32 bits</B>.</p> },
  { id: "nethost", chapter: "Network part vs host part", title: "Some bits name the network. The rest name a device.", body: <p>With <B>/24</B>, the first 24 bits are the <b style={{ color: "#c4b5fd" }}>network</b>. The last 8 are the <b style={{ color: "#6ee7b7" }}>host</b>, one device inside it. Slide the device number: only the host bits change.</p> },
  { id: "slash24", chapter: "What does /24 mean?", title: "/24 = 24 network bits.", body: <p>32 bits in total, minus 24 network bits, leaves <B>8 host bits</B>. Eight bits make <B>2⁸ = 256</B> combinations, which is where 256 comes from.</p> },
  { id: "mask24", chapter: "What is a subnet mask?", title: "The mask: the same split, as 1s and 0s.", body: <p>1 = network bit, 0 = host bit. Group the 32 bits into octets and you get <B>255.255.255.0</B>. So /24 and 255.255.255.0 say the same thing.</p> },
  { id: "mask26", chapter: "What is a subnet mask?", title: "/26 = 255.255.255.192.", body: <p>Two more 1s in the last octet: 11000000 = 128 + 64 = <B>192</B>. Press play to sweep the line through the last octet.</p> },
  { id: "classes", chapter: "IPv4 classes (history)", title: "History: five address classes.", body: <><p>Early IPv4 (before 1993) grouped addresses by their <B>first octet</B>. A, B and C were networks with fixed sizes (/8, /16, /24). D is multicast, E experimental. 127.x is loopback.</p><p className="mt-1.5">This is <B>history</B>. Nothing in a modern design is decided by the first octet, and the line is not stuck at /8, /16 or /24: that&apos;s the next step.</p></> },
  { id: "cidr", chapter: "CIDR replaced classes", title: "Today: CIDR. The line can go anywhere.", body: <p>Fixed class sizes wasted huge amounts of space. <B>CIDR</B> (1993) writes the prefix with every network: /20, /23, /27… “Class C” in conversation just means “a /24”. Think in prefixes.</p> },
  { id: "slider", chapter: "The prefix slider", title: "Move the line. Everything changes together.", body: <p>Drag the slider or press play. Each step right moves one bit from host to network: <B>more network bits → more subnets</B>, <B>fewer host bits → smaller subnets</B>.</p> },
  { id: "eq-addr", chapter: "The equations", title: "Addresses in a subnet = 2^h", body: <p>h = host bits. For a /27: 32 − 27 = <B>5</B> host bits, and 2⁵ = <B>32</B> addresses. Try other prefixes under the block.</p> },
  { id: "eq-usable", chapter: "The equations", title: "Usable hosts = 2^h − 2", body: <p>Two addresses in every ordinary subnet are reserved: the first (network) and the last (broadcast). 32 − 2 = <B>30</B> for devices.</p> },
  { id: "eq-subnets", chapter: "The equations", title: "Subnets = 2^s", body: <p>s = <B>borrowed bits</B>, host bits handed to the network side. 1 borrowed bit → 2 subnets, 2 → 4, 3 → 8. Each borrowed bit doubles them.</p> },
  { id: "netaddr", chapter: "Network address", title: "Every subnet has a network address.", body: <p>Take <B>10.44.0.192/27</B>. Its first address has <B>all host bits 0</B> (110 | 00000). That value names the subnet itself; no device gets it.</p> },
  { id: "bcast", chapter: "Broadcast address", title: "…and a broadcast address.", body: <p>Flip every host bit to 1: 110 | 11111 = <B>.223</B>, the last address. It means “every device in this subnet”. Devices use .193–.222.</p> },
  { id: "bounds", chapter: "Valid boundaries", title: "A /27 can only start every 32.", body: <p>Starts are where the host bits are all 0: .0, .32, .64 … .224. <B>.192</B> is a start. <B>.200</B> is not: it is an address <i>inside</i> the .192 subnet. Tap the tests below the bar.</p> },
  { id: "flsm", chapter: "FLSM", title: "FLSM: every subnet the same size.", body: <p><B>Fixed-Length Subnet Mask</B>: one prefix for all. Four /26 blocks for four networks needing 100, 50, 25 and 2. LAN-A needs 100 but a /26 holds 62, so it doesn&apos;t fit.</p> },
  { id: "vlsm", chapter: "VLSM", title: "VLSM: each subnet gets its own size.", body: <p><B>Variable-Length Subnet Mask</B>: LAN-A /25, LAN-B /26, LAN-C /27, Transit /30. Different sizes fit side by side in the same /24, and space is left over.</p> },
  { id: "design-req", chapter: "Design a real network", title: "Start with the requirements.", body: <p>LAN-A 100, LAN-B 50, LAN-C 25 addresses and a 2-router transit link (each count includes the router). For each one, the <B>smallest block with 2^h − 2 ≥ needed</B>: /25, /26, /27, /30.</p> },
  { id: "design-place", chapter: "Design a real network", title: "Place every block on its own boundary.", body: <p>A /25 may only start every 128, a /26 every 64, a /27 every 32, a /30 every 4. Placing the <B>largest first</B> is convenient: big blocks have the fewest legal starts, and the rest slot in after them. Another order can also be valid; the rules decide, not the order.</p> },
  { id: "design-verify", chapter: "Design a real network", title: "Verify it, then prove it on the network.", body: <><p>Every block big enough, on its boundary, inside the /24, and no address in two networks. Then the free space: .228–.255 is 28 addresses, but it can&apos;t hold a /27 (32) — and even 32 free addresses only count if they start on a multiple of 32.</p><p className="mt-1.5">A plan isn&apos;t done when the table looks right: apply it to the router and hosts, and ping.</p></> },
  { id: "summary", chapter: "The whole idea", title: "You now have the whole mental model.", body: <p>Next, the <B>Subnet Explorer</B>: the same ideas, as things you can move and break yourself.</p> },
];

// =============================================================================================================
// Visual pieces
// =============================================================================================================
interface Seg {
  id: string;
  label: string;
  color: string;
  first: number;
  size: number;
  /** Fraction of the block that is used (FLSM fill). */
  fill?: number;
  /** Addresses that spill out past the block. */
  over?: number;
}
interface Mark {
  at: number;
  label: string;
  ok?: boolean;
}

/** The address space of the /24 as one bar, divided into equal blocks. Blocks persist by start, so a split is a shrink + an appearance. */
function AddressBar({ prefix, title, segs, marks, ticks, dim, big, onBlock, active }: { prefix: number; title?: ReactNode; segs?: Seg[]; marks?: Mark[]; ticks?: number[]; dim?: boolean; big?: ReactNode; onBlock?: (start: number) => void; active?: number }) {
  const size = 2 ** (32 - prefix);
  const n = prefix - 24;
  const blocks = Array.from({ length: 256 / size }, (_, k) => k * size);
  return (
    <div className="w-full">
      {title && <p className="mb-2 text-center pv-mono text-[15px] font-bold text-pv-text sm:text-[19px]">{title}</p>}
      <div className="relative" style={{ height: "clamp(78px, 15vh, 150px)", marginTop: marks?.length ? 28 : 0 }}>
        {blocks.map((s, k) => {
          const on = active !== undefined && s === active;
          return (
            <button
              key={s}
              type="button"
              tabIndex={onBlock ? 0 : -1}
              onClick={() => onBlock?.(s)}
              aria-label={`10.44.0.${s}/${prefix}, ${size} addresses`}
              className={clsx("sl-grow absolute inset-y-0 overflow-hidden rounded-lg border-2 text-left transition-[left,width,background-color,border-color] duration-700 ease-out motion-reduce:transition-none", onBlock ? "cursor-pointer hover:brightness-125" : "cursor-default")}
              style={{
                left: `calc(${(s / 256) * 100}% + 2px)`,
                width: `calc(${(size / 256) * 100}% - 4px)`,
                background: dim ? "rgba(148,163,184,0.07)" : on ? "rgba(34,211,238,0.5)" : k % 2 ? "rgba(34,211,238,0.30)" : "rgba(34,211,238,0.15)",
                borderColor: dim ? "rgba(148,163,184,0.25)" : on ? "#ffffff" : "rgba(34,211,238,0.65)",
              }}
            >
              {!dim && (
                <span className="flex h-full flex-col items-center justify-center px-0.5 text-center leading-tight">
                  {n === 0 && big ? (
                    big
                  ) : n <= 4 ? (
                    <>
                      {n <= 3 && <span className="pv-mono text-[11px] font-bold text-pv-text sm:text-[14px]">/{prefix}</span>}
                      <span className="pv-mono text-[10px] text-pv-text-muted sm:text-[12px]">{n <= 2 ? `.${s}–.${s + size - 1}` : `.${s}`}</span>
                      {n <= 2 && <span className="text-[10px] text-pv-text-muted sm:text-[12px]">{size} addresses</span>}
                    </>
                  ) : null}
                </span>
              )}
            </button>
          );
        })}
        {segs?.map((g) => (
          <div key={g.id} className="pointer-events-none absolute inset-y-1.5 transition-[left,width] duration-700 ease-out motion-reduce:transition-none" style={{ left: `calc(${(g.first / 256) * 100}% + 4px)`, width: `max(5px, calc(${(g.size / 256) * 100}% - 8px))` }}>
            <div className="absolute inset-0 overflow-hidden rounded-md border-2" style={{ borderColor: g.color, background: alpha(g.color, 0.1) }}>
              <div className="absolute inset-y-0 left-0 transition-[width] duration-700" style={{ width: `${Math.min(1, g.fill ?? 1) * 100}%`, background: alpha(g.color, 0.5) }} />
            </div>
            <span className={clsx("absolute whitespace-nowrap pv-mono text-[11px] font-bold sm:text-[13px]", g.size >= 24 ? "left-1.5 top-1" : "-top-5 right-0")} style={{ color: g.size >= 24 ? "#fff" : g.color }}>
              {g.label}
            </span>
            {!!g.over && <div className="absolute inset-y-0 rounded-r-md" style={{ left: "100%", width: `calc(${(g.over / g.size) * 100}% + 8px)`, backgroundImage: CLASH }} />}
          </div>
        ))}
        {marks?.map((m) => (
          <div key={m.label} className="sl-pop pointer-events-none absolute -top-7 -translate-x-1/2 text-center" style={{ left: `${((m.at + 0.5) / 256) * 100}%` }}>
            <span className={clsx("block whitespace-nowrap rounded px-1.5 pv-mono text-[12px] font-bold", m.ok === undefined ? "bg-pv-bg text-pv-text" : m.ok ? "bg-pv-success/20 text-pv-success" : "bg-pv-danger/20 text-pv-danger")}>{m.label}</span>
            <span className={clsx("block text-[12px] leading-none", m.ok === false ? "text-pv-danger" : m.ok ? "text-pv-success" : "text-pv-text")}>▼</span>
          </div>
        ))}
      </div>
      {ticks && (
        <div className="relative mt-1 h-4" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute -translate-x-1/2 pv-mono text-[10px] text-pv-text-faint sm:text-[11px]" style={{ left: `${(t / 256) * 100}%` }}>
              {t}
            </span>
          ))}
          <span className="absolute right-0 pv-mono text-[10px] text-pv-text-faint sm:text-[11px]">255</span>
        </div>
      )}
    </div>
  );
}

function SplitButtons({ value, onPick, options = [24, 25, 26, 27, 28] }: { value: number; onPick: (p: number) => void; options?: number[] }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5" role="group" aria-label="Split the network">
      <span className="text-[12.5px] text-pv-text-muted">Split it yourself:</span>
      {options.map((p) => (
        <button key={p} type="button" aria-pressed={value === p} onClick={() => onPick(p)} className={clsx("rounded-full border px-3 py-1 pv-mono text-[13.5px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan", value === p ? "border-pv-cyan bg-pv-cyan/20 text-pv-text" : "border-pv-border text-pv-text-muted hover:text-pv-text")}>
          /{p}
        </button>
      ))}
    </div>
  );
}

/** Big centred statement lines that appear one after another. */
function Lines({ k, lines, size = "lg" }: { k: string; lines: ReactNode[]; size?: "lg" | "md" }) {
  return (
    <div key={k} className="space-y-1.5 text-center">
      {lines.map((l, i) => (
        <p key={i} className={clsx("sl-pop pv-mono font-bold text-pv-text", size === "lg" ? "text-[19px] sm:text-[26px]" : "text-[15px] sm:text-[19px]")} style={{ animationDelay: `${i * 450}ms` }}>
          {l}
        </p>
      ))}
    </div>
  );
}

// --- Company devices that regroup into subnets -----------------------------------------------------------------
const BOXES: Record<Dept, { x: number; y: number; w: number; h: number; cols: number }> = {
  Sales: { x: 2, y: 3, w: 55, h: 52, cols: 8 },
  IT: { x: 61, y: 3, w: 37, h: 52, cols: 5 },
  Cameras: { x: 2, y: 60, w: 55, h: 37, cols: 6 },
  Servers: { x: 61, y: 60, w: 37, h: 37, cols: 4 },
};
function CompanyDots({ grouped, bcast }: { grouped: boolean; bcast: boolean }) {
  const dots = useMemo(() => {
    const seen: Record<Dept, number> = { Sales: 0, IT: 0, Cameras: 0, Servers: 0 };
    return MIXED.map((d, mixedIndex) => ({ d, k: seen[d]++, mixedIndex }));
  }, []);
  const color = (d: Dept) => DEPTS.find((x) => x.id === d)!.color;
  const pos = (d: Dept, k: number, mixedIndex: number) => {
    if (!grouped) {
      const c = mixedIndex % 10;
      const r = Math.floor(mixedIndex / 10);
      return { left: 6 + (c + 0.5) * 8.8, top: 12 + (r + 0.5) * 10.4 };
    }
    const b = BOXES[d];
    const n = DEPTS.find((x) => x.id === d)!.n;
    const rows = Math.ceil(n / b.cols);
    return { left: b.x + 3 + ((k % b.cols) + 0.5) * ((b.w - 6) / b.cols), top: b.y + 12 + (Math.floor(k / b.cols) + 0.5) * ((b.h - 15) / rows) };
  };
  const sender = dots.find((x) => x.d === "Cameras" && x.k === 0)!;
  const reached = bcast ? (grouped ? DEPTS.find((x) => x.id === "Cameras")!.n - 1 : 79) : 0;
  return (
    <div className="w-full">
      <div className="relative w-full" style={{ paddingTop: "62%" }}>
        <div className="absolute rounded-2xl border-2 transition-opacity duration-500" style={{ left: "1%", top: "1%", width: "98%", height: "98%", borderColor: "rgba(255,255,255,0.5)", opacity: grouped ? 0 : 1 }}>
          <span className="absolute left-2 top-1 text-[12px] font-bold text-pv-text sm:text-[14px]">ONE NETWORK · 10.44.0.0/24</span>
        </div>
        {DEPTS.map((d) => {
          const b = BOXES[d.id];
          return (
            <div key={d.id} className="absolute rounded-xl border-2 transition-opacity duration-500" style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%`, borderColor: d.color, background: alpha(d.color, 0.06), opacity: grouped ? 1 : 0 }}>
              <span className="absolute left-1.5 top-0.5 text-[11px] font-bold sm:text-[13px]" style={{ color: d.color }}>
                {d.id} subnet
              </span>
            </div>
          );
        })}
        <div className="absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-pv-bg text-[12px] font-bold text-white transition-opacity duration-500 sm:h-10 sm:w-10" style={{ left: "59%", top: "57.5%", opacity: grouped ? 1 : 0 }} title="Router">
          R
        </div>
        {dots.map(({ d, k, mixedIndex }) => {
          const p = pos(d, k, mixedIndex);
          const isSender = d === sender.d && k === sender.k;
          const hit = bcast && !isSender && (!grouped || d === "Cameras");
          return (
            <span
              key={`${d}-${k}`}
              className={clsx("absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left,top,box-shadow,opacity] duration-[900ms] ease-in-out motion-reduce:transition-none sm:h-3.5 sm:w-3.5", isSender && bcast && "sl-pulse")}
              style={{ left: `${p.left}%`, top: `${p.top}%`, background: color(d), transitionDelay: `${mixedIndex * 7}ms`, opacity: bcast && !hit && !isSender ? 0.25 : 1, boxShadow: isSender && bcast ? "0 0 0 4px #ffffff, 0 0 18px #ffffff" : hit ? "0 0 0 2px #ffffff, 0 0 12px 2px rgba(248,113,113,0.95)" : undefined }}
            />
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[12.5px] text-pv-text-muted">
        {DEPTS.map((d) => (
          <span key={d.id} className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
            {d.id} {d.n}
          </span>
        ))}
      </div>
      {bcast && (
        <p className={clsx("sl-pop mt-2 text-center text-[15px] font-bold", grouped ? "text-pv-success" : "text-pv-danger")}>
          📣 One camera broadcast reaches {reached} other device{reached === 1 ? "" : "s"}
          {grouped ? ": only the other cameras." : ": every device in the company."}
        </p>
      )}
    </div>
  );
}

// --- Classes ----------------------------------------------------------------------------------------------------
const FIRST_OCTET = [
  { id: "0", from: 0, to: 0, c: "#475569", note: "reserved" },
  { id: "A", from: 1, to: 126, c: "#22d3ee" },
  { id: "127", from: 127, to: 127, c: "#f87171", note: "loopback" },
  { id: "B", from: 128, to: 191, c: "#a78bfa" },
  { id: "C", from: 192, to: 223, c: "#34d399" },
  { id: "D", from: 224, to: 239, c: "#f472b6" },
  { id: "E", from: 240, to: 255, c: "#94a3b8" },
];
const CLASS_CARDS = [
  { id: "A", range: "1–126", prefix: "/8", mask: "255.0.0.0", size: `${fmt(2 ** 24)} addresses`, c: "#22d3ee" },
  { id: "B", range: "128–191", prefix: "/16", mask: "255.255.0.0", size: `${fmt(2 ** 16)} addresses`, c: "#a78bfa" },
  { id: "C", range: "192–223", prefix: "/24", mask: "255.255.255.0", size: "256 addresses", c: "#34d399" },
  { id: "D", range: "224–239", prefix: "—", mask: "—", size: "multicast", c: "#f472b6" },
  { id: "E", range: "240–255", prefix: "—", mask: "—", size: "experimental / reserved", c: "#94a3b8" },
];
function ClassChart({ pick, onPick }: { pick?: string; onPick: (id: string) => void }) {
  return (
    <div className="w-full space-y-3">
      <div>
        <p className="mb-1 text-center text-[12.5px] text-pv-text-muted">The first octet decided the class</p>
        <div className="flex h-10 overflow-hidden rounded-lg border border-pv-border">
          {FIRST_OCTET.map((s) => {
            const w = ((s.to - s.from + 1) / 256) * 100;
            const on = pick === s.id;
            return (
              <button key={s.id} type="button" onClick={() => onPick(s.id)} title={s.note ?? `Class ${s.id}: ${s.from}–${s.to}`} className="flex items-center justify-center overflow-hidden text-[12px] font-bold transition-colors" style={{ width: `max(4px, ${w}%)`, background: alpha(s.c, on ? 0.6 : 0.22), color: on ? "#fff" : "#cbd5e1" }}>
                {w > 5 ? s.id : ""}
              </button>
            );
          })}
        </div>
        <div className="relative mt-0.5 h-4 pv-mono text-[10.5px] text-pv-text-faint" aria-hidden>
          {[0, 128, 192, 224, 240].map((t) => (
            <span key={t} className="absolute -translate-x-1/2" style={{ left: `${(t / 256) * 100}%` }}>
              {t}
            </span>
          ))}
        </div>
        <p className="text-center text-[12px] text-pv-text-muted">
          <span className="text-pv-danger">127.x.x.x</span> is <b className="text-pv-text">loopback</b> (this device itself), not an ordinary Class A network. 0 is reserved.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
        {CLASS_CARDS.map((c) => {
          const on = pick === c.id;
          return (
            <button key={c.id} type="button" onClick={() => onPick(c.id)} className={clsx("rounded-xl border-2 p-2 text-left transition-colors", on ? "bg-white/[0.06]" : "")} style={{ borderColor: alpha(c.c, on ? 1 : 0.5) }}>
              <p className="text-[14px] font-bold" style={{ color: c.c }}>
                Class {c.id}
              </p>
              <p className="pv-mono text-[11.5px] text-pv-text-muted">first octet {c.range}</p>
              <p className="pv-mono text-[13px] font-bold text-pv-text">{c.prefix}</p>
              <p className="pv-mono text-[11px] text-pv-text-muted">{c.mask}</p>
              <p className="text-[11px] text-pv-text-faint">{c.size}</p>
            </button>
          );
        })}
      </div>
      <p className="text-center text-[12.5px] text-pv-text-muted">A, B, C = ordinary networks with fixed sizes · D, E = not for ordinary hosts</p>
    </div>
  );
}

function Ruler32({ lines, active, label, tone }: { lines: number[]; active?: number; label: string; tone: "old" | "new" }) {
  return (
    <div>
      <p className={clsx("mb-1 text-[12px] font-bold uppercase tracking-[0.14em]", tone === "old" ? "text-pv-text-faint" : "text-pv-cyan-soft")}>{label}</p>
      <div className="relative grid gap-px" style={{ gridTemplateColumns: "repeat(32, minmax(0, 1fr))" }}>
        {Array.from({ length: 32 }, (_, i) => {
          const net = active !== undefined && i < active;
          return <span key={i} className="h-6 rounded-[2px] transition-colors duration-500" style={{ background: tone === "old" ? "rgba(148,163,184,0.14)" : net ? "rgba(167,139,250,0.5)" : "rgba(52,211,153,0.25)" }} />;
        })}
        {lines.map((l) => (
          <span key={l} className={clsx("absolute -inset-y-1 w-[3px] -translate-x-1/2 rounded transition-[left] duration-500 ease-out", tone === "old" ? "bg-pv-text-muted" : "bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]")} style={{ left: `${(l / 32) * 100}%` }}>
            <span className={clsx("absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap pv-mono text-[11px] font-bold", tone === "old" ? "text-pv-text-muted" : "text-white")}>/{l}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** NNNNNNNN.NNNNNNNN.NNNNNNNN.NNNHHHHH with the borrowed bits highlighted. */
function BorrowBits({ s }: { s: number }) {
  return (
    <div className="space-y-2 text-center">
      <p className="pv-mono text-[13px] text-pv-text-faint sm:text-[15px]">
        NNNNNNNN.NNNNNNNN.NNNNNNNN.<span className="text-pv-text">last octet ↓</span>
      </p>
      <div className="mx-auto grid max-w-md grid-cols-8 gap-1.5">
        {Array.from({ length: 8 }, (_, i) => {
          const borrowed = i < s;
          return (
            <span key={`${i}-${borrowed}`} className={clsx("flex h-11 items-center justify-center rounded-lg border-2 pv-mono text-[20px] font-bold sm:h-14 sm:text-[26px]", borrowed && i === s - 1 && "sl-flip")} style={{ borderColor: borrowed ? "#fbbf24" : alpha("#34d399", 0.6), background: borrowed ? "rgba(251,191,36,0.2)" : "rgba(52,211,153,0.1)", color: borrowed ? "#fde68a" : "#bbf7d0" }}>
              {borrowed ? "N" : "H"}
            </span>
          );
        })}
      </div>
      <p className="text-[12.5px] text-pv-text-muted">
        <span className="text-pv-warning">N</span> = borrowed bit (now network) · <span className="text-pv-success">H</span> = host bit
      </p>
    </div>
  );
}

/** One block as squares, with optional roles (network / usable / broadcast). */
function BlockSquares({ start, prefix, roles, focus }: { start: number; prefix: number; roles?: boolean; focus?: number }) {
  const size = 2 ** (32 - prefix);
  const cells: CellView[] = blank();
  paint(cells, start, size, (i) => (roles ? (i === 0 ? { fill: "rgba(167,139,250,0.6)", tag: "N" } : i === size - 1 ? { fill: "rgba(251,191,36,0.6)", tag: "B" } : { fill: "rgba(52,211,153,0.32)" }) : { fill: "rgba(34,211,238,0.3)", pour: i }));
  if (focus !== undefined) cells[focus] = { ...cells[focus], ring: "info" };
  const cols = size >= 64 ? 16 : size >= 8 ? 8 : size;
  return <AddressGrid key={`${start}-${prefix}`} cells={cells} start={start} count={size} cols={cols} size={size <= 32 ? "zoom" : "board"} numbers="all" label={`Block 10.44.0.${start}/${prefix}`} />;
}

/** Steps that share a visual keep the same stage instance, so the picture animates between them instead of reappearing. */
const VISUAL: Record<StepId, string> = {
  intro: "bar", what: "bar", split26: "bar", split27: "bar",
  "why-one": "why", "why-split": "why", "why-list": "why",
  ipv4: "ip", octets: "ip", binary: "ip", nethost: "nethost", slash24: "slash24",
  mask24: "mask", mask26: "mask", slider: "slider",
  "eq-addr": "eq", "eq-usable": "eq", "eq-subnets": "eqs",
  classes: "classes", cidr: "cidr", netaddr: "nb", bcast: "nb", bounds: "bounds",
  flsm: "plan", vlsm: "plan", "design-req": "design", "design-place": "design", "design-verify": "design", summary: "summary",
};

// =============================================================================================================
// The presentation
// =============================================================================================================
export function SubnetPresentation({ step, onStep, goRef, onDone }: { step: number; onStep: (i: number) => void; goRef: MutableRefObject<((i: number) => void) | undefined>; onDone: () => void }) {
  const id = STEPS[step].id;

  // Stage state (each step sets sensible defaults; the learner may then play with it).
  const [barP, setBarP] = useState(24);
  const [bcast, setBcast] = useState(false);
  const [host, setHost] = useState(25);
  const [maskP, setMaskP] = useState(24);
  const [sliderP, setSliderP] = useState(24);
  const [prevP, setPrevP] = useState<number | undefined>(undefined);
  const [eqP, setEqP] = useState(27);
  const [borrow, setBorrow] = useState(1);
  const [cls, setCls] = useState<string | undefined>("C");
  const [cidrP, setCidrP] = useState(20);
  const [test, setTest] = useState(200);
  const [showSpecial, setShowSpecial] = useState(false);
  const [play, stop, playing] = useStepper();

  const sliderNow = useRef(24);
  const slide = useCallback((p: number) => {
    setPrevP(sliderNow.current);
    sliderNow.current = p;
    setSliderP(p);
  }, []);

  // Entering a step sets its stage defaults (state adjusted during render when the step changes).
  const [enteredId, setEnteredId] = useState<StepId | "">("");
  if (enteredId !== id) {
    setEnteredId(id);
    if (id === "intro") setBarP(24);
    if (id === "what") setBarP(25);
    if (id === "split26") setBarP(26);
    if (id === "split27") setBarP(27);
    if (id === "why-one" || id === "why-split") setBcast(false);
    if (id === "nethost") setHost(25);
    if (id === "mask24") setMaskP(24);
    if (id === "mask26") setMaskP(26);
    if (id === "eq-addr" || id === "eq-usable") setEqP(27);
    if (id === "eq-subnets") setBorrow(1);
    if (id === "cidr") setCidrP(20);
    if (id === "bounds") setTest(200);
  }
  useEffect(() => stop, [id, stop]);

  const sweepMask = () => play([24, 25, 26, 27, 28, 29, 30], 900, (p) => setMaskP(p));
  const playSlider = () => play([24, 25, 26, 27, 28, 29, 30], 1300, (p) => slide(p));
  const h = 32 - eqP;

  // ---------------------------------------------------------------------------------------------------- stage
  const stage = (): ReactNode => {
    const s = STEPS[step];
    const head = <StageHead chapter={s.chapter} title={s.title} />;
    switch (id) {
      case "intro":
      case "what":
      case "split26":
      case "split27":
        return (
          <>
            {head}
            <AddressBar prefix={barP} title={barP === 24 ? "10.44.0.0/24" : `10.44.0.0/24 → ${2 ** (barP - 24)} × /${barP}`} big={<span className="pv-mono text-[15px] font-bold text-pv-text sm:text-[22px]">ONE NETWORK · 256 ADDRESSES</span>} ticks={[0, 64, 128, 192]} />
            <p key={barP} className="sl-pop text-center text-[15px] font-semibold text-pv-text sm:text-[18px]">
              {barP === 24 ? "Every address of the network, from .0 to .255." : `${2 ** (barP - 24)} networks × ${2 ** (32 - barP)} addresses = 256. No new addresses; the same space, divided.`}
            </p>
            {id !== "intro" && <SplitButtons value={barP} onPick={setBarP} />}
          </>
        );
      case "why-one":
      case "why-split":
      case "why-list":
        return (
          <>
            {head}
            <CompanyDots grouped={id !== "why-one"} bcast={bcast} />
            {id === "why-list" ? (
              <div className="flex flex-wrap justify-center gap-1.5">
                {["Organize addresses", "Separate groups", "Smaller broadcast domains", "Routing & security policy", "Efficient allocation", "Easier to manage"].map((r, i) => (
                  <span key={r} className="sl-pop rounded-full border border-pv-success/50 bg-pv-success/10 px-3 py-1 text-[13px] font-semibold text-pv-text" style={{ animationDelay: `${i * 250}ms` }}>
                    ✓ {r}
                  </span>
                ))}
              </div>
            ) : (
              <div className="flex justify-center">
                <button type="button" onClick={() => setBcast((b) => !b)} className="rounded-full border border-pv-warning/60 bg-pv-warning/10 px-4 py-1.5 text-[14px] font-semibold text-pv-text hover:bg-pv-warning/20">
                  {bcast ? "Clear" : "📣 A camera sends a broadcast"}
                </button>
              </div>
            )}
          </>
        );
      case "ipv4":
      case "octets":
      case "binary": {
        const oct = [10, 44, 0, 25];
        return (
          <>
            {head}
            <p className="text-center pv-mono text-[34px] font-bold text-pv-text sm:text-[54px]">10.44.0.25</p>
            {id !== "ipv4" && (
              <div className="sl-pop mx-auto grid w-full max-w-xl grid-cols-4 gap-2 text-center">
                {oct.map((o, i) => (
                  <div key={i} className="rounded-xl border border-pv-border bg-pv-bg/60 p-2">
                    <p className="pv-mono text-[22px] font-bold text-pv-text sm:text-[28px]">{o}</p>
                    <p className="text-[12px] text-pv-text-muted">↓ 8 bits</p>
                  </div>
                ))}
              </div>
            )}
            {id === "binary" && (
              <div className="sl-pop">
                <FullBits octets={oct} prefix={32} neutral />
              </div>
            )}
            <p className="text-center text-[18px] font-bold text-pv-cyan-soft sm:text-[22px]">IPv4 = 32 bits</p>
          </>
        );
      }
      case "nethost":
        return (
          <>
            {head}
            <p className="text-center pv-mono text-[28px] font-bold sm:text-[40px]">
              <span style={{ color: "#c4b5fd" }}>10.44.0</span>
              <span style={{ color: "#6ee7b7" }}>.{host}</span>
              <span className="text-pv-text-faint">/24</span>
            </p>
            <FullBits octets={[10, 44, 0, host]} prefix={24} />
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl border-2 p-2" style={{ borderColor: "#a78bfa" }}>
                <p className="text-[13px] font-bold" style={{ color: "#c4b5fd" }}>NETWORK · first 24 bits</p>
                <p className="text-[12.5px] text-pv-text-muted">which network: the same for every device here</p>
              </div>
              <div className="rounded-xl border-2 p-2" style={{ borderColor: "#34d399" }}>
                <p className="text-[13px] font-bold" style={{ color: "#6ee7b7" }}>HOST · last 8 bits</p>
                <p className="text-[12.5px] text-pv-text-muted">which device inside it</p>
              </div>
            </div>
            <label className="mx-auto flex w-full max-w-md items-center gap-2 text-[13px] text-pv-text-muted">
              device <input type="range" min={1} max={254} value={host} onChange={(e) => setHost(Number(e.target.value))} className="flex-1 accent-[#34d399]" aria-label="Device number" /> <span className="pv-mono text-pv-text">.{host}</span>
            </label>
          </>
        );
      case "slash24":
        return (
          <>
            {head}
            <FullBits octets={[10, 44, 0, 0]} prefix={24} />
            <Lines k="s24" lines={["/24 → 24 network bits", "32 − 24 = 8 host bits", <>8 host bits → 2⁸ = <span className="text-pv-cyan-soft">256 addresses</span></>]} />
            <AddressBar prefix={24} big={<span className="pv-mono text-[14px] font-bold text-pv-text sm:text-[18px]">256 ADDRESSES</span>} />
          </>
        );
      case "mask24":
      case "mask26": {
        const mo = [255, 255, 255, 256 - 2 ** (32 - maskP)];
        return (
          <>
            {head}
            <FullBits octets={mo} prefix={maskP} mask />
            <p key={maskP} className="sl-pop text-center pv-mono text-[24px] font-bold text-pv-text sm:text-[34px]">
              /{maskP} = 255.255.255.{mo[3]}
            </p>
            {id === "mask26" && (
              <>
                <div className="mx-auto flex flex-wrap justify-center gap-1">
                  {[24, 25, 26, 27, 28, 29, 30].map((p) => (
                    <button key={p} type="button" onClick={() => setMaskP(p)} className={clsx("rounded-lg border px-2 py-1 text-center pv-mono leading-tight", p === maskP ? "border-pv-cyan bg-pv-cyan/15" : "border-pv-border")}>
                      <span className="block text-[13px] font-bold text-pv-text">/{p}</span>
                      <span className="block text-[11px] text-pv-text-muted">.{256 - 2 ** (32 - p)}</span>
                    </button>
                  ))}
                </div>
                <div className="flex justify-center">
                  <button type="button" onClick={playing ? stop : sweepMask} className="rounded-full border border-pv-cyan/60 px-4 py-1.5 text-[14px] font-semibold text-pv-cyan-soft hover:bg-pv-cyan/10">
                    {playing ? "Pause" : "▶ Sweep the line through the last octet"}
                  </button>
                </div>
              </>
            )}
            <p className="text-center text-[14px] text-pv-text-muted">A subnet mask is another way of showing which bits belong to the network.</p>
          </>
        );
      }
      case "slider":
        return (
          <>
            {head}
            <div className="rounded-2xl border border-pv-cyan/40 bg-pv-cyan/[0.05] p-3">
              <div className="flex items-center gap-3">
                <button type="button" onClick={playing ? stop : playSlider} aria-label={playing ? "Pause" : "Play /24 to /30"} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pv-cyan text-[16px] font-bold text-[#03131a]">
                  {playing ? "❚❚" : "▶"}
                </button>
                <input type="range" min={24} max={30} value={sliderP} onChange={(e) => slide(Number(e.target.value))} className="flex-1 accent-[#22d3ee]" aria-label="Prefix" aria-valuetext={`/${sliderP}`} />
                <span className="w-14 text-right pv-mono text-[26px] font-bold text-pv-cyan-soft">/{sliderP}</span>
              </div>
            </div>
            <ChainStrip prefix={sliderP} prev={prevP} />
            <AddressBar prefix={sliderP} big={<span className="pv-mono text-[14px] font-bold text-pv-text sm:text-[18px]">1 NETWORK · 256</span>} />
            <BorrowBits s={sliderP - 24} />
            <div className="grid grid-cols-2 gap-2 text-center text-[13px] font-bold sm:text-[15px]">
              <p className="rounded-xl border border-pv-violet/50 bg-pv-violet/10 p-2 text-pv-text">MORE NETWORK BITS → MORE SUBNETS</p>
              <p className="rounded-xl border border-pv-success/50 bg-pv-success/10 p-2 text-pv-text">FEWER HOST BITS → SMALLER SUBNETS</p>
            </div>
          </>
        );
      case "eq-addr":
      case "eq-usable":
        return (
          <>
            {head}
            <div className="flex flex-wrap justify-center gap-1">
              {[25, 26, 27, 28, 29, 30].map((p) => (
                <button key={p} type="button" onClick={() => setEqP(p)} className={clsx("rounded-full border px-3 py-1 pv-mono text-[13px] font-bold", p === eqP ? "border-pv-cyan bg-pv-cyan/20 text-pv-text" : "border-pv-border text-pv-text-muted")}>
                  /{p}
                </button>
              ))}
            </div>
            {id === "eq-addr" ? (
              <Lines k={`a${eqP}`} size="md" lines={[`/${eqP} → 32 − ${eqP} = ${h} host bits`, <>{pow(h)} = <span className="text-pv-cyan-soft">{2 ** h} addresses</span></>]} />
            ) : (
              <Lines k={`u${eqP}`} size="md" lines={[`${2 ** h} addresses = 1 network + ${2 ** h - 2} usable + 1 broadcast`, <>{pow(h)} − 2 = <span className="text-pv-success">{2 ** h - 2} usable hosts</span></>]} />
            )}
            <div className="mx-auto w-full max-w-lg">
              <BlockSquares start={192 & (256 - 2 ** h)} prefix={eqP} roles={id === "eq-usable"} />
            </div>
            {id === "eq-usable" && (
              <div className="text-center">
                <button type="button" onClick={() => setShowSpecial((v) => !v)} className="text-[12.5px] font-semibold text-pv-cyan-soft underline-offset-2 hover:underline">
                  {showSpecial ? "Hide" : "Optional: what about /31 and /32?"}
                </button>
                {showSpecial && <p className="sl-pop mx-auto mt-1 max-w-lg text-[12.5px] text-pv-text-muted">The −2 rule is for ordinary LAN subnets. A /31 (2 addresses) is a special point-to-point link where both addresses are usable, and a /32 is a single address (one host route). You won&apos;t need them in this lab.</p>}
              </div>
            )}
          </>
        );
      case "eq-subnets":
        return (
          <>
            {head}
            <BorrowBits s={borrow} />
            <Lines k={`b${borrow}`} size="md" lines={[`/${24 + borrow}: ${borrow} borrowed bit${borrow > 1 ? "s" : ""}`, <>{pow(borrow)} = <span className="text-pv-cyan-soft">{2 ** borrow} subnets</span> of {2 ** (8 - borrow)}</>]} />
            <AddressBar prefix={24 + borrow} />
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <span className="text-[12.5px] text-pv-text-muted">Borrow:</span>
              {[1, 2, 3, 4].map((b) => (
                <button key={b} type="button" onClick={() => setBorrow(b)} className={clsx("rounded-full border px-3 py-1 pv-mono text-[13px] font-bold", b === borrow ? "border-pv-warning bg-pv-warning/20 text-pv-text" : "border-pv-border text-pv-text-muted")}>
                  {b} bit{b > 1 ? "s" : ""}
                </button>
              ))}
            </div>
          </>
        );
      case "classes":
        return (
          <>
            {head}
            <ClassChart pick={cls} onPick={setCls} />
          </>
        );
      case "cidr":
        return (
          <>
            {head}
            <div className="space-y-6 rounded-2xl border border-pv-border bg-pv-bg/50 p-3 pt-6">
              <Ruler32 lines={[8, 16, 24]} label="Old way: only three places for the line (A /8 · B /16 · C /24)" tone="old" />
              <Ruler32 lines={[cidrP]} active={cidrP} label="Modern way, CIDR: the line can sit at any bit" tone="new" />
            </div>
            <div className="flex flex-wrap justify-center gap-1">
              {[8, 16, 20, 23, 24, 25, 26, 27, 28].map((p) => (
                <button key={p} type="button" onClick={() => setCidrP(p)} className={clsx("rounded-full border px-2.5 py-1 pv-mono text-[13px] font-bold", p === cidrP ? "border-pv-cyan bg-pv-cyan/20 text-pv-text" : "border-pv-border text-pv-text-muted")}>
                  /{p}
                </button>
              ))}
            </div>
            <p key={cidrP} className="sl-pop text-center text-[16px] font-semibold text-pv-text sm:text-[19px]">
              /{cidrP} → {fmt(2 ** (32 - cidrP))} addresses{[8, 16, 24].includes(cidrP) ? " (also an old class size)" : ": impossible in the classful world"}
            </p>
          </>
        );
      case "netaddr":
      case "bcast":
        return (
          <>
            {head}
            <p className="text-center pv-mono text-[24px] font-bold text-pv-text sm:text-[32px]">
              10.44.0.<span style={{ color: id === "netaddr" ? "#c4b5fd" : "#fde68a" }}>{id === "netaddr" ? 192 : 223}</span>/27
            </p>
            <BitBar octet={id === "netaddr" ? 192 : 223} prefix={27} />
            <p key={id} className="sl-pop text-center text-[17px] font-bold sm:text-[20px]" style={{ color: id === "netaddr" ? "#c4b5fd" : "#fde68a" }}>
              {id === "netaddr" ? "NETWORK ADDRESS = all host bits 0" : "BROADCAST ADDRESS = all host bits 1"}
            </p>
            <div className="mx-auto w-full max-w-lg">
              <BlockSquares start={192} prefix={27} roles={id === "bcast"} focus={id === "netaddr" ? 192 : 223} />
            </div>
            {id === "bcast" && (
              <div className="mx-auto grid max-w-md grid-cols-4 gap-1 text-center pv-mono text-[12px] sm:text-[13px]">
                <span className="rounded bg-pv-violet/20 p-1 text-pv-text">.192 network</span>
                <span className="rounded bg-pv-success/15 p-1 text-pv-text">.193 first usable</span>
                <span className="rounded bg-pv-success/15 p-1 text-pv-text">.222 last usable</span>
                <span className="rounded bg-pv-warning/20 p-1 text-pv-text">.223 broadcast</span>
              </div>
            )}
          </>
        );
      case "bounds": {
        const start = test & 224;
        const ok = start === test;
        return (
          <>
            {head}
            <AddressBar prefix={27} marks={[{ at: test, label: `.${test} ${ok ? "✓ start" : "✕ inside"}`, ok }]} active={start} ticks={[0, 32, 64, 96, 128, 160, 192, 224]} onBlock={(s) => setTest(s)} />
            <p key={test} className="sl-pop text-center text-[16px] font-semibold text-pv-text sm:text-[19px]">
              {ok ? `.${test} is where a /27 block starts: its 5 host bits are all 0.` : `.${test} is an address inside the .${start}–.${start + 31} subnet, not the start of one.`}
            </p>
            <BitBar octet={test} prefix={27} clear />
            {!ok && <p className="text-center pv-mono text-[15px] text-pv-text-muted">{test} AND 224 = <b className="text-pv-text">{start}</b> (clear the host bits → the real start)</p>}
            <div className="flex flex-wrap justify-center gap-1.5">
              {[192, 200, 96, 100, 224].map((t) => (
                <button key={t} type="button" onClick={() => setTest(t)} className={clsx("rounded-full border px-3 py-1 pv-mono text-[13px] font-bold", t === test ? "border-pv-cyan bg-pv-cyan/20 text-pv-text" : "border-pv-border text-pv-text-muted")}>
                  test .{t}
                </button>
              ))}
            </div>
          </>
        );
      }
      case "flsm":
      case "vlsm": {
        const v = id === "vlsm";
        const at: Record<string, number> = { "LAN-A": 0, "LAN-B": 128, "LAN-C": 192, TRANSIT: 224 };
        const segs: Seg[] = SEGMENTS.map((sg, i) => {
          const p = v ? slMinPrefix(sg.hosts) : 26;
          const size = 2 ** (32 - p);
          const usable = size - 2;
          return { id: sg.id, label: `${segName(sg.id)} /${p}`, color: SEG_COLOR[sg.id], first: v ? at[sg.id] : i * 64, size, fill: Math.min(1, (sg.hosts + 1) / size), over: !v && sg.hosts > usable ? sg.hosts - usable : 0 };
        });
        if (v) segs.push({ id: "free", label: "free", color: "#64748b", first: 228, size: 28, fill: 0 });
        return (
          <>
            {head}
            <AddressBar prefix={v ? 24 : 26} dim segs={segs} ticks={[0, 64, 128, 192]} />
            <div className="mx-auto grid w-full max-w-xl grid-cols-2 gap-1.5 sm:grid-cols-4">
              {SEGMENTS.map((sg) => {
                const p = v ? slMinPrefix(sg.hosts) : 26;
                const usable = 2 ** (32 - p) - 2;
                const fits = usable >= sg.hosts;
                return (
                  <div key={sg.id} className="rounded-xl border-2 p-2 text-center" style={{ borderColor: SEG_COLOR[sg.id] }}>
                    <p className="text-[13px] font-bold" style={{ color: SEG_COLOR[sg.id] }}>
                      {segName(sg.id)}
                    </p>
                    <p className="text-[12px] text-pv-text-muted">needs {sg.hosts}</p>
                    <p className={clsx("pv-mono text-[13px] font-bold", fits ? "text-pv-success" : "text-pv-danger")}>
                      /{p} holds {usable} {fits ? "✓" : "✕"}
                    </p>
                  </div>
                );
              })}
            </div>
            <p key={id} className={clsx("sl-pop text-center text-[16px] font-semibold sm:text-[19px]", v ? "text-pv-success" : "text-pv-danger")}>
              {v ? "Different sizes, one /24: everything fits, and .228–.255 is still free." : "Equal sizes: LAN-A spills out (red), while Transit wastes 60 of its 62."}
            </p>
          </>
        );
      }
      case "design-req":
      case "design-place":
      case "design-verify": {
        const at: Record<string, number> = { "LAN-A": 0, "LAN-B": 128, "LAN-C": 192, TRANSIT: 224 };
        const placedNow = id !== "design-req";
        const segs: Seg[] = placedNow ? SEGMENTS.map((sg) => {
          const p = slMinPrefix(sg.hosts);
          const size = 2 ** (32 - p);
          return { id: sg.id, label: `${segName(sg.id)} /${p}`, color: SEG_COLOR[sg.id], first: at[sg.id], size, fill: Math.min(1, (sg.hosts + 1) / size) };
        }) : [];
        if (id === "design-verify") segs.push({ id: "free", label: "free", color: "#64748b", first: 228, size: 28, fill: 0 });
        return (
          <>
            {head}
            {id === "design-req" ? (
              <div className="mx-auto grid w-full max-w-xl grid-cols-2 gap-1.5 sm:grid-cols-4">
                {SEGMENTS.map((sg, i) => {
                  const p = slMinPrefix(sg.hosts);
                  return (
                    <div key={sg.id} className="sl-pop rounded-xl border-2 p-2 text-center" style={{ borderColor: SEG_COLOR[sg.id], animationDelay: `${i * 200}ms` }}>
                      <p className="text-[13px] font-bold" style={{ color: SEG_COLOR[sg.id] }}>{segName(sg.id)}</p>
                      <p className="text-[12px] text-pv-text-muted">needs {sg.hosts}</p>
                      <p className="pv-mono text-[12.5px] text-pv-text">2^{32 - p} − 2 = {2 ** (32 - p) - 2}</p>
                      <p className="pv-mono text-[15px] font-bold text-pv-success">/{p}</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <AddressBar prefix={24} dim segs={segs} ticks={[0, 64, 128, 192, 224]} />
            )}
            {id === "design-place" && (
              <p className="text-center pv-mono text-[13px] text-pv-text-muted sm:text-[14px]">.0 = 0 × 128 · .128 = 2 × 64 · .192 = 6 × 32 · .224 = 56 × 4 — every start a multiple of its own size</p>
            )}
            {id === "design-verify" && (
              <div className="mx-auto grid w-full max-w-xl grid-cols-2 gap-1.5 text-[13px] sm:grid-cols-3">
                {["✓ big enough", "✓ on its boundary", "✓ inside the /24", "✓ no overlap", "28 free ≠ a /27", "→ apply & ping"].map((t, i) => (
                  <span key={t} className={clsx("sl-pop rounded-full border px-3 py-1 text-center font-semibold", i < 4 ? "border-pv-success/50 bg-pv-success/10 text-pv-text" : "border-pv-warning/50 bg-pv-warning/10 text-pv-text")} style={{ animationDelay: `${i * 220}ms` }}>
                    {t}
                  </span>
                ))}
              </div>
            )}
          </>
        );
      }
      case "summary":
        return (
          <>
            {head}
            <ol className="mx-auto w-full max-w-md space-y-1">
              {["IPv4 address", "32 bits", "network bits + host bits", "the prefix chooses the boundary", "host bits decide the block size (2^h)", "subnetting moves the boundary right", "more network bits = more, smaller networks", "blocks start on multiples of their size", "FLSM = equal sizes · VLSM = right sizes", "design: requirements → sizes → boundaries → verify → apply"].map((t, i) => (
                <li key={t} className="sl-pop text-center" style={{ animationDelay: `${i * 220}ms` }}>
                  {i > 0 && <span className="block text-[12px] leading-none text-pv-text-faint">↓</span>}
                  <span className="inline-block rounded-lg border border-pv-cyan/40 bg-pv-cyan/[0.07] px-3 py-1 text-[14px] font-semibold text-pv-text sm:text-[15.5px]">{t}</span>
                </li>
              ))}
            </ol>
            <div className="flex justify-center">
              <button type="button" onClick={onDone} className="rounded-full bg-pv-cyan px-6 py-3 text-[16px] font-bold text-[#03131a] shadow-[0_0_24px_rgba(34,211,238,0.45)] hover:brightness-110">
                Explore it yourself →
              </button>
            </div>
          </>
        );
    }
  };

  return (
    <>
      <style>{MOTION_CSS + `
        @media (prefers-reduced-motion: no-preference) { .sl-grow { animation: slGrow .6s cubic-bezier(.22,1,.36,1) both; } }
        @keyframes slGrow { from { opacity: 0; transform: scaleX(.6); } to { opacity: 1; transform: none; } }
      `}</style>
      {/* Shared deck: placement below the pinned header / phone stage, keyboard steps, balanced titles. */}
      <ScrollyDeck
        steps={STEPS}
        step={step}
        onStep={onStep}
        goRef={goRef}
        stage={stage()}
        visualKey={VISUAL[id]}
        label="Presentation steps"
        finalAction={
          <button type="button" onClick={onDone} className="rounded-full bg-pv-cyan px-5 py-2 text-[15px] font-bold text-[#03131a] hover:brightness-110">
            Explore it yourself →
          </button>
        }
      />
    </>
  );
}

/**
 * The presentation on its own, for the lesson page ("New to subnetting?" card, Lesson Guide bridge, and before the
 * first lab open). Same steps and stage as inside the Subnet Explorer; presentation state only.
 */
export function SubnetPresentationOverlay({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [step, setStep] = useState(0);
  const goRef = useRef<((i: number) => void) | undefined>(undefined);
  const onStep = useCallback((i: number) => setStep(i), []);
  const final = { label: finishLabel, onClick: onFinish };
  return (
    <PracticeLabShell
      open={open}
      onClose={onClose}
      title="Subnetting, from zero"
      sandboxNote="A visual presentation · nothing here changes your progress"
      onReset={() => goRef.current?.(0)}
      stages={[]}
      currentStage={0}
      loop={{ labels: ["Learn", "Explore", "Calculate", "Plan", "Engineer"], current: 0 }}
      primaryAction={(compact) => (compact ? <DeckNav step={step} count={STEPS.length} goRef={goRef} compact final={final} /> : null)}
      topology={<DeckHeader kicker="Learn · the subnetting presentation" steps={STEPS} step={step} goRef={goRef} skip={{ label: "Skip →", onClick: onFinish }} final={final} />}
      topologyClassName="h-auto max-w-6xl"
      board={<SubnetPresentation step={step} onStep={onStep} goRef={goRef} onDone={onFinish} />}
    />
  );
}
