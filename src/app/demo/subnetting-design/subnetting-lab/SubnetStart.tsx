"use client";

import { useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { blockSize } from "@/lib/sim-engine/scenarios/subnettingDesign";
import { slMinPrefix } from "@/lib/sim-engine/scenarios/subnettingLab";
import { AddressGrid, Legend, type CellView } from "./SubnetGrid";
import { BitBar, Btn, FullBits, HOST, Idea, Lead, NET, Now, Predict, Scene, TryList, alpha, blank, paint, useSeen, useStepper } from "./SubnetKit";

/**
 * START HERE — the minimum mental model, rebuilt visually before any subnetting:
 *   1 · An address has two parts   32 bits; the prefix line splits network bits from host bits; the mask is a stencil
 *   2 · Host bits make addresses   every host bit doubles the addresses: 8 host bits → 2⁸ = 256 (the /24 board)
 *   3 · Why subnet?                one big network vs four department networks: broadcasts, a router checkpoint, sizing
 *   4 · Classes, then CIDR         classful A/B/C as history (fixed lines, wasteful), then CIDR: the line goes anywhere
 */

const BOARD_LABEL = "Address board 10.44.0.0/24: 256 addresses, 16 per row";

// =============================================================================================================
// 1 · An address has two parts
// =============================================================================================================
export function StartTwoParts() {
  const [host, setHostRaw] = useState(25);
  const [third, setThird] = useState(0);
  const [showMask, setShowMask] = useState(false);
  const [seen, mark] = useSeen();
  const setHost = (h: number) => {
    setHostRaw(h);
    mark("host");
  };
  const cells: CellView[] = blank().map(() => ({ fill: third === 0 ? "rgba(34,211,238,0.14)" : "rgba(148,163,184,0.06)", dim: third !== 0 }));
  if (third === 0) cells[host] = { ...cells[host], fill: "rgba(52,211,153,0.7)", ring: "ok" };

  return (
    <Scene
      board={
        <div className="space-y-3">
          <div className="rounded-xl border border-pv-border bg-pv-bg/50 p-2.5">
            <p className="mb-1.5 text-center pv-mono text-[22px] font-bold sm:text-[26px]">
              <span style={{ color: "#c4b5fd" }}>10.44.{third}</span>
              <span style={{ color: "#6ee7b7" }}>.{host}</span>
              <span className="text-pv-text-faint">/24</span>
            </p>
            <FullBits octets={[10, 44, third, host]} prefix={24} />
            {showMask && (
              <div className="sl-pop mt-3 border-t border-pv-border pt-2.5">
                <FullBits octets={[255, 255, 255, 0]} prefix={24} mask title="The mask 255.255.255.0: a stencil. 1 = network bit, 0 = host bit." />
              </div>
            )}
          </div>
          <AddressGrid cells={cells} onTap={(o) => third === 0 && setHost(o)} label={BOARD_LABEL} footer={<p className="mt-1.5 text-center text-[12px] text-pv-text-muted">{third === 0 ? "Network 10.44.0.0/24: all 256 host values. The lit square is this device." : "This device is on 10.44.1.0/24, a different network. Not this board."}</p>} />
        </div>
      }
      extra={showMask ? 250 : 150}
      hint="Tap a square: the device changes, the network part doesn't"
      side={
        <>
          <Lead kicker="Explore · 1 of 7" title="An IPv4 address has two parts">
            <p>
              An IPv4 address is <b className="text-pv-text">32 bits</b>, written as four numbers (one per 8 bits). The <b style={{ color: "#c4b5fd" }}>first part names the network</b>; the <b style={{ color: "#6ee7b7" }}>last part names one device on it</b>. Think street name + house number.
            </p>
          </Lead>
          <div className="rounded-2xl border border-pv-cyan/35 bg-pv-cyan/[0.05] p-3">
            <label htmlFor="sl-host" className="flex items-baseline justify-between text-[13px] font-semibold text-pv-text-muted">
              Change the device <span className="pv-mono text-[18px] text-pv-text">.{host}</span>
            </label>
            <input id="sl-host" type="range" min={0} max={255} value={host} onChange={(e) => setHost(Number(e.target.value))} className="mt-1 w-full accent-[#34d399]" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn
              tone="quiet"
              pressed={third === 1}
              onClick={() => {
                setThird((t) => (t ? 0 : 1));
                mark("other");
              }}
            >
              {third ? "← Back to 10.44.0.x" : "Show a different network: 10.44.1.x"}
            </Btn>
            <Btn
              tone="quiet"
              pressed={showMask}
              onClick={() => {
                setShowMask((m) => !m);
                mark("mask");
              }}
            >
              {showMask ? "Hide the mask" : "Show the mask"}
            </Btn>
          </div>
          {third === 1 ? (
            <Now k="other" tone="warn" title="Same last number, different network.">
              <p>
                Only one <b style={{ color: NET }}>network bit</b> changed (the third number went 0 → 1), and that&apos;s enough: 10.44.1.{host} is on another network. Devices on different networks need a <b className="text-pv-text">router</b> between them.
              </p>
            </Now>
          ) : showMask ? (
            <Now k="mask" title="/24 is just the mask, counted.">
              <p>
                The mask has <b style={{ color: NET }}>24 ones</b> then <b style={{ color: HOST }}>8 zeros</b>. Written as numbers: 255.255.255.0. Written short: <b className="text-pv-text">/24</b>, the number of 1s. Same meaning, three spellings.
              </p>
            </Now>
          ) : (
            <Now k={`h${host}`} title={`10.44.0.${host}: network 10.44.0 · device ${host}`}>
              <p>
                Move the device slider. Only the <b style={{ color: HOST }}>8 host bits</b> change. The <b style={{ color: NET }}>24 network bits</b> stay put: every device on this network starts with 10.44.0.
              </p>
            </Now>
          )}
          <Idea>
            <p>
              <b>/24</b> = the first <b style={{ color: "#c4b5fd" }}>24 bits</b> are the network; the remaining <b style={{ color: "#6ee7b7" }}>8 bits</b> number the devices inside it.
            </p>
            <p className="text-pv-text-muted">The white line is the prefix. Everything in this lab comes from moving that line.</p>
          </Idea>
          <Predict
            q="Which two addresses are on the same /24 network?"
            options={["10.44.0.7 and 10.44.0.200", "10.44.0.7 and 10.44.1.7"]}
            answer={0}
            onTest={() => {
              setThird(0);
              setHost(200);
            }}
            explain={<p>Compare the first 24 bits: 10.44.0 and 10.44.0 match. The last number can be anything. 10.44.1.7 has a different network part, even though it ends in 7 too.</p>}
          />
          <TryList
            items={[
              { text: <>Slide the device number and watch which bits change.</>, done: !!seen.host },
              { text: <>Show a different network: what changed?</>, done: !!seen.other },
              { text: <>Show the mask and count its 1s.</>, done: !!seen.mask },
            ]}
          />
        </>
      }
    />
  );
}

// =============================================================================================================
// 2 · Host bits make addresses
// =============================================================================================================
const COMBOS: Record<number, string> = { 1: "0 · 1", 2: "00 · 01 · 10 · 11", 3: "000 · 001 · 010 · 011 · 100 · 101 · 110 · 111" };

export function StartHostBits() {
  const [h, setHRaw] = useState(1);
  const [focus, setFocus] = useState<number | undefined>(undefined);
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const [seen, mark] = useSeen();
  const [play, stop, playing] = useStepper();
  const setH = (v: number) => {
    setHRaw(v);
    setCursor(undefined);
    mark(`h${v}`);
  };
  const count = 2 ** h;
  const cells: CellView[] = blank().map((_, o) => ({ fill: o < count ? (cursor !== undefined && o <= cursor ? "rgba(52,211,153,0.6)" : "rgba(52,211,153,0.32)") : "rgba(148,163,184,0.05)", dim: o >= count, pour: o }));
  if (focus !== undefined && focus < count) cells[focus] = { ...cells[focus], ring: "info" };
  if (playing && cursor !== undefined) cells[cursor] = { ...cells[cursor], ring: "ok" };
  const shown = focus !== undefined && focus < count ? focus : playing ? cursor : undefined;
  const countAll = () => {
    mark("count");
    setFocus(undefined);
    play(
      Array.from({ length: count }, (_, i) => i),
      h >= 7 ? 12 : 40,
      (i) => setCursor(i),
    );
  };

  return (
    <Scene
      board={<AddressGrid cells={cells} onHover={setFocus} onTap={setFocus} label={`${count} of 256 squares lit: ${h} host bits`} footer={<Legend items={[{ color: "rgba(52,211,153,0.6)", label: `the ${count} addresses ${h} host bit${h > 1 ? "s" : ""} can make` }]} />} />}
      hint="Add host bits one at a time and watch the lit area double"
      side={
        <>
          <Lead kicker="Explore · 2 of 7" title="Host bits make addresses">
            <p>Each host bit can be 0 or 1. So how many different device numbers do the host bits give you? Add them one at a time.</p>
          </Lead>
          <div className="rounded-2xl border border-pv-cyan/35 bg-pv-cyan/[0.05] p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] font-semibold text-pv-text-muted">Host bits</span>
              <span className="pv-mono text-[24px] font-bold" style={{ color: "#6ee7b7" }}>
                {h}
              </span>
            </div>
            <div className="mt-1 grid grid-cols-8 gap-1" role="group" aria-label="Number of host bits">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((v) => (
                <button key={v} type="button" aria-pressed={v === h} onClick={() => setH(v)} className={clsx("rounded-lg border py-1.5 pv-mono text-[14px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan", v <= h ? "border-pv-success/60 bg-pv-success/20 text-pv-text" : "border-pv-border text-pv-text-faint hover:text-pv-text")}>
                  {v}
                </button>
              ))}
            </div>
          </div>
          <BitBar octet={shown} prefix={32 - h} caption={<p>The green bits on the right are the host bits you&apos;re using. The rest are held at 0 here.</p>} />
          <Now k={`h${h}`} tone={h === 8 ? "ok" : "info"} title={`${h} host bit${h > 1 ? "s" : ""} → 2${"⁰¹²³⁴⁵⁶⁷⁸"[h]} = ${count} addresses`}>
            {COMBOS[h] ? <p className="pv-mono text-pv-text">{COMBOS[h]}</p> : <p>Too many to list. Each bit you added doubled the count: {Array.from({ length: h }, (_, i) => 2 ** (i + 1)).join(" → ")}.</p>}
            {h === 8 ? <p>This is the whole board: <b className="text-pv-text">a /24 leaves 32 − 24 = 8 host bits, so it holds 256 addresses</b>.</p> : <p>Add one more bit and the lit area doubles.</p>}
          </Now>
          <div className="flex flex-wrap gap-2">
            {playing ? (
              <Btn tone="quiet" onClick={stop}>
                Pause
              </Btn>
            ) : (
              <Btn tone="quiet" onClick={countAll}>
                Count them one by one
              </Btn>
            )}
          </div>
          <Idea>
            <p>
              Every host bit <b>doubles</b> the number of addresses. h host bits → <b>2^h</b> addresses.
            </p>
            <p className="text-pv-text-muted">Keep this in your pocket. Later, when the prefix takes host bits away, each bit taken halves the addresses.</p>
          </Idea>
          <Predict q="With 5 host bits, how many addresses?" options={["10", "25", "32"]} answer={2} onTest={() => setH(5)} explain={<p>2 → 4 → 8 → 16 → 32. Five doublings: 2⁵ = 32, exactly two rows of this board.</p>} />
          <TryList
            items={[
              { text: <>Go from 1 to 3 host bits and read every combination.</>, done: !!seen.h3 },
              { text: <>Go all the way to 8: the full /24.</>, done: !!seen.h8 },
              { text: <>Count them one by one.</>, done: !!seen.count },
            ]}
          />
        </>
      }
    />
  );
}

// =============================================================================================================
// 3 · Why subnet?
// =============================================================================================================
export type Dept = "Sales" | "IT" | "Cameras" | "Servers";
export const DEPTS: { id: Dept; n: number; color: string }[] = [
  { id: "Sales", n: 40, color: "#22d3ee" },
  { id: "IT", n: 20, color: "#a78bfa" },
  { id: "Cameras", n: 12, color: "#f472b6" },
  { id: "Servers", n: 8, color: "#fbbf24" },
];
/** Smallest block for each department (devices + its router port), placed largest first. */
const SUBNETS = (() => {
  let at = 0;
  return DEPTS.map((d) => {
    const p = slMinPrefix(d.n + 1);
    const s = { ...d, prefix: p, start: at, size: blockSize(p) };
    at += blockSize(p);
    return s;
  });
})();
/** One big network: departments mixed together on .1–.80, the way devices land when nobody plans. */
export const MIXED: Dept[] = (() => {
  const left = Object.fromEntries(DEPTS.map((d) => [d.id, d.n])) as Record<Dept, number>;
  const out: Dept[] = [];
  for (let k = 0; k < 80; k++) {
    const pick = DEPTS.reduce((best, d) => (left[d.id] / d.n > left[best.id] / best.n ? d : best), DEPTS[0]);
    out.push(pick.id);
    left[pick.id]--;
  }
  return out;
})();
const REASONS: { id: string; t: string; d: string }[] = [
  { id: "group", t: "Separate groups", d: "Each department gets its own network with a clear boundary." },
  { id: "bcast", t: "Smaller broadcast domains", d: "A broadcast only reaches its own network, not everyone." },
  { id: "policy", t: "Routing and policy", d: "Traffic between networks passes a router, where rules can allow or block it." },
  { id: "size", t: "Sized to real needs", d: "Each network gets a block that fits its devices." },
];

export function StartWhySubnet() {
  const [mode, setMode] = useState<"one" | "split">("one");
  const [demo, setDemo] = useState<"none" | "bcast" | "path">("none");
  const [seen, mark] = useSeen();
  const cells = blank();
  const devices: { o: number; d: Dept }[] = [];
  if (mode === "one") {
    paint(cells, 0, 256, () => ({ fill: "rgba(148,163,184,0.06)", group: "all", groupColor: "rgba(255,255,255,0.55)" }));
    MIXED.forEach((d, i) => devices.push({ o: i + 2, d }));
    cells[1] = { ...cells[1], tag: "R", fill: "rgba(255,255,255,0.35)" };
  } else {
    for (const s of SUBNETS) {
      paint(cells, s.start, s.size, () => ({ fill: alpha(s.color, 0.1), group: s.id, groupColor: s.color }));
      cells[s.start + 1] = { ...cells[s.start + 1], tag: "R", fill: alpha(s.color, 0.6) };
      for (let k = 0; k < s.n; k++) devices.push({ o: s.start + 2 + k, d: s.id });
    }
  }
  const color = (d: Dept) => DEPTS.find((x) => x.id === d)!.color;
  for (const { o, d } of devices) cells[o] = { ...cells[o], fill: alpha(color(d), 0.62) };
  const cams = devices.filter((x) => x.d === "Cameras");
  const sender = cams[0];
  const server = devices.find((x) => x.d === "Servers")!;
  let reached = 0;
  if (demo === "bcast") {
    for (const x of devices) if (x !== sender && (mode === "one" || x.d === "Cameras")) {
      cells[x.o] = { ...cells[x.o], ring: "bad" };
      reached++;
    }
    cells[sender.o] = { ...cells[sender.o], ring: "info", tag: "!" };
  }
  if (demo === "path") {
    cells[sender.o] = { ...cells[sender.o], ring: "info", tag: "C" };
    cells[server.o] = { ...cells[server.o], ring: "info", tag: "S" };
    if (mode === "split") {
      const camNet = SUBNETS.find((s) => s.id === "Cameras")!;
      const srvNet = SUBNETS.find((s) => s.id === "Servers")!;
      cells[camNet.start + 1] = { ...cells[camNet.start + 1], ring: "ok" };
      cells[srvNet.start + 1] = { ...cells[srvNet.start + 1], ring: "ok" };
    }
  }
  const choose = (m: "one" | "split") => {
    setMode(m);
    mark(m);
    if (m === "split") mark("group");
  };
  const run = (d: "bcast" | "path") => {
    setDemo(d);
    mark(d === "bcast" ? "bcast" : "policy");
  };

  return (
    <Scene
      board={<AddressGrid cells={cells} numbers="none" label={mode === "one" ? "One big network: 80 devices mixed together" : "Four department networks"} footer={<Legend items={DEPTS.map((d) => ({ color: d.color, label: `${d.id} ${d.n}` }))} />} />}
      hint={mode === "one" ? "Everyone shares one network (R = the router)" : "Each department has its own network and its own router port (R)"}
      side={
        <>
          <Lead kicker="Explore · 3 of 7" title="Why divide a network at all?">
            <p>
              A company has <b className="text-pv-text">Sales 40, IT 20, Cameras 12, Servers 8</b> devices, and one /24 with 256 addresses. Compare one big network with one network per department.
            </p>
          </Lead>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Layout">
            <Btn tone="quiet" pressed={mode === "one"} onClick={() => choose("one")}>
              One big network
            </Btn>
            <Btn tone="quiet" pressed={mode === "split"} onClick={() => choose("split")}>
              Subnetted: 4 networks
            </Btn>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Btn tone="quiet" pressed={demo === "bcast"} onClick={() => run("bcast")}>
              📣 A camera sends a broadcast
            </Btn>
            <Btn tone="quiet" pressed={demo === "path"} onClick={() => run("path")}>
              A camera talks to a server
            </Btn>
          </div>
          {demo === "bcast" ? (
            <Now k={`b${mode}`} tone={mode === "one" ? "bad" : "ok"} title={mode === "one" ? `${reached} devices receive it.` : `Only ${reached} devices receive it: the other cameras.`}>
              <p>{mode === "one" ? "A broadcast goes to everyone on the network. Every Sales PC, IT laptop and server has to stop and look at it. The bigger the network, the more noise." : "Broadcasts stop at the edge of their network; routers don't forward them. Each network is its own broadcast domain."}</p>
            </Now>
          ) : demo === "path" ? (
            <Now k={`p${mode}`} tone={mode === "one" ? "warn" : "ok"} title={mode === "one" ? "Directly, no checkpoint." : "Through the router: a checkpoint."}>
              <p>{mode === "one" ? "On one big network every device can reach every other directly. There is nowhere to say “cameras may only talk to the recording server”." : "Different networks must go through a router (green rings: the two router ports). That's where routing decisions and security rules live."}</p>
            </Now>
          ) : (
            <Now k={mode} title={mode === "one" ? "One network: all 80 devices mixed on 10.44.0.0/24." : "Same 256 addresses, now four networks."}>
              <p>{mode === "one" ? "It works, but everyone is in one big room: no boundaries, everyone hears every broadcast. Try the two buttons above." : "Each department got its own block, sized for its devices plus a router port (R). The rest of the /24 stays free for later. Nothing was added: the same space was divided."}</p>
              {mode === "split" && (
                <ul className="pv-mono text-[13px]">
                  {SUBNETS.map((x) => (
                    <li key={x.id}>
                      <span style={{ color: x.color }}>{x.id.padEnd(8, " ")}</span> 10.44.0.{x.start}/{x.prefix} <span className="font-sans text-pv-text-faint">({x.size} addresses)</span>
                    </li>
                  ))}
                </ul>
              )}
            </Now>
          )}
          <Idea title="So, what is subnetting?">
            <p>
              <b>Subnetting</b> = taking one IP network and <b>dividing its address space into smaller IP networks</b>.
            </p>
            <p className="text-pv-text-muted">No new addresses appear. The same 256 are cut into blocks, and the next chapters show exactly how the cut works.</p>
          </Idea>
          <div className="rounded-2xl border border-pv-border bg-pv-bg-elevated/30 p-3">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-pv-text-faint">Why engineers do it</p>
            <ul className="mt-1.5 space-y-1">
              {REASONS.map((r) => {
                const done = !!seen[r.id] || (r.id === "size" && mode === "split");
                return (
                  <li key={r.id} className={clsx("text-[13.5px] leading-snug", done ? "text-pv-text" : "text-pv-text-muted")}>
                    <span className={clsx("mr-1.5 font-bold", done ? "text-pv-success" : "text-pv-text-faint")}>{done ? "✓" : "○"}</span>
                    <b>{r.t}</b>: {r.d}
                  </li>
                );
              })}
            </ul>
          </div>
          <TryList
            items={[
              { text: <>Send a camera broadcast in both layouts and compare who hears it.</>, done: !!seen.bcast && !!seen.one && !!seen.split },
              { text: <>Make a camera talk to a server in the subnetted layout.</>, done: !!seen.policy && mode === "split" },
            ]}
          />
        </>
      }
    />
  );
}

// =============================================================================================================
// 4 · Classes, then CIDR
// =============================================================================================================
const CLASSES: { id: "A" | "B" | "C"; prefix: number; first: [number, number]; lead: number; ex: number[]; color: string }[] = [
  { id: "A", prefix: 8, first: [0, 127], lead: 1, ex: [10, 0, 0, 0], color: "#22d3ee" },
  { id: "B", prefix: 16, first: [128, 191], lead: 2, ex: [172, 16, 0, 0], color: "#a78bfa" },
  { id: "C", prefix: 24, first: [192, 223], lead: 3, ex: [192, 168, 1, 0], color: "#34d399" },
];
const fmt = (n: number) => n.toLocaleString("en-US");

export function StartClassesCidr() {
  const [mode, setMode] = useState<"class" | "cidr">("class");
  const [cls, setCls] = useState<"A" | "B" | "C">("C");
  const [cidr, setCidr] = useState(23);
  const [seen, mark] = useSeen();
  const c = CLASSES.find((x) => x.id === cls)!;
  const prefix = mode === "class" ? c.prefix : cidr;
  const octets = mode === "class" ? c.ex : [10, 44, 0, 0];
  const size = 2 ** (32 - prefix);
  const need = 300;
  const classFor300 = CLASSES.find((x) => 2 ** (32 - x.prefix) - 2 >= need && x.id !== "A") ?? CLASSES[1];

  const rangeBar: ReactNode = (
    <div>
      <p className="mb-1 text-[12.5px] font-semibold text-pv-text-muted">Old rule: the class came from the first number of the address</p>
      <div className="flex h-9 overflow-hidden rounded-lg border border-pv-border text-[11.5px] font-bold">
        {[
          { l: "A · 0–127", w: 50, id: "A" },
          { l: "B · 128–191", w: 25, id: "B" },
          { l: "C · 192–223", w: 12.5, id: "C" },
          { l: "D/E", w: 12.5, id: "DE" },
        ].map((s) => {
          const on = mode === "class" && s.id === cls;
          const col = CLASSES.find((x) => x.id === s.id)?.color ?? "#64748b";
          return (
            <span key={s.id} className="flex items-center justify-center truncate px-1 transition-colors" style={{ width: `${s.w}%`, background: alpha(col, on ? 0.45 : 0.12), color: on ? "#fff" : "#94a3b8" }}>
              {s.l}
            </span>
          );
        })}
      </div>
      {mode === "cidr" && <p className="mt-1 text-[12px] text-pv-text-muted">10.44.0.0 starts with 10, which is the old Class A range. With CIDR, that no longer decides anything.</p>}
    </div>
  );

  return (
    <Scene
      board={
        <div className="space-y-4">
          {rangeBar}
          <div className="rounded-xl border border-pv-border bg-pv-bg/50 p-2.5">
            <p className="mb-1.5 text-center pv-mono text-[22px] font-bold">
              {octets.join(".")}
              <span className="text-pv-cyan-soft">/{prefix}</span>
            </p>
            <FullBits octets={octets} prefix={prefix} lead={mode === "class" ? c.lead : undefined} />
            {mode === "class" && <p className="mt-1 text-[12px] text-pv-text-muted">Yellow outline: the leading bits that marked Class {cls} ({cls === "A" ? "0…" : cls === "B" ? "10…" : "110…"}).</p>}
          </div>
          <div className="rounded-xl border border-pv-border bg-pv-bg/50 p-2.5 text-center">
            <p className="text-[12px] text-pv-text-faint">Addresses in this network</p>
            <p className="pv-mono text-[26px] font-bold text-pv-text">{fmt(size)}</p>
            <p className="text-[12px] text-pv-text-muted">2^{32 - prefix} (from {32 - prefix} host bits)</p>
          </div>
        </div>
      }
      side={
        <>
          <Lead kicker="Explore · 4 of 7" title="Classes A/B/C (history), then CIDR (today)">
            <p>You&apos;ll hear people say “a Class C network”. Here&apos;s what that meant, and why modern networks don&apos;t work that way.</p>
          </Lead>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Era">
            <Btn
              tone="quiet"
              pressed={mode === "class"}
              onClick={() => {
                setMode("class");
              }}
            >
              Before 1993: classes
            </Btn>
            <Btn
              tone="quiet"
              pressed={mode === "cidr"}
              onClick={() => {
                setMode("cidr");
                mark("cidr");
              }}
            >
              Today: CIDR
            </Btn>
          </div>
          {mode === "class" ? (
            <>
              <div className="flex gap-1.5" role="group" aria-label="Class">
                {CLASSES.map((x) => (
                  <Btn
                    key={x.id}
                    tone="quiet"
                    pressed={cls === x.id}
                    onClick={() => {
                      setCls(x.id);
                      mark(`c${x.id}`);
                    }}
                  >
                    Class {x.id} → /{x.prefix}
                  </Btn>
                ))}
              </div>
              <Now k={`c${cls}`} title={`Class ${cls}: first number ${c.first[0]}–${c.first[1]}, line fixed at /${c.prefix}.`}>
                <p>
                  The network/host line could only sit at <b className="text-pv-text">/8, /16 or /24</b>, decided by the address itself. So a network had {fmt(2 ** 24)}, {fmt(2 ** 16)} or {fmt(256)} addresses, nothing in between.
                </p>
                <p>
                  The problem: a company needing <b className="text-pv-text">{need}</b> addresses was too big for a C ({fmt(254)} devices), so it got a Class {classFor300.id}: <b className="text-pv-danger">{fmt(2 ** (32 - classFor300.prefix))} addresses, over 65,000 wasted</b>.
                </p>
              </Now>
            </>
          ) : (
            <>
              <div className="rounded-2xl border border-pv-cyan/35 bg-pv-cyan/[0.05] p-3">
                <label htmlFor="sl-cidr" className="flex items-baseline justify-between text-[13px] font-semibold text-pv-text-muted">
                  Put the line anywhere <span className="pv-mono text-[22px] text-pv-cyan-soft">/{cidr}</span>
                </label>
                <input
                  id="sl-cidr"
                  type="range"
                  min={8}
                  max={30}
                  value={cidr}
                  onChange={(e) => {
                    setCidr(Number(e.target.value));
                    mark("slide");
                  }}
                  className="mt-1 w-full accent-[#22d3ee]"
                />
              </div>
              <Now k={`x${cidr}`} tone={size - 2 >= need ? "ok" : "info"} title={`/${cidr}: ${32 - cidr} host bits → ${fmt(size)} addresses.`}>
                <p>
                  <b className="text-pv-text">CIDR</b> (Classless Inter-Domain Routing) dropped the classes: the prefix is written with every address, and the line can sit at any bit. A {need}-address need gets a /23 ({fmt(512)}), not 65,536.
                  {size - 2 >= need ? (cidr === 23 ? " That's the /23 shown now." : "") : ` /${cidr} is too small for ${need}; try /23.`}
                </p>
              </Now>
            </>
          )}
          <Idea title="Think in CIDR">
            <p>
              A network is described by its <b>prefix</b>: /8, /16, /24, /27… The old class of the first number doesn&apos;t matter, and subnetting does not have to start from a class boundary.
            </p>
            <p className="text-pv-text-muted">
              “Class C” in conversation usually just means “a /24”. Know the phrase, but don&apos;t think in it. This lesson&apos;s 10.44.0.0/24 is simply <b className="text-pv-text">a /24</b>.
            </p>
          </Idea>
          <Predict
            q="Is 10.44.0.0/24 a “Class C network”?"
            options={["Yes, it's a /24", "No"]}
            answer={1}
            onTest={() => {
              setMode("cidr");
              setCidr(24);
              mark("cidr");
            }}
            explain={<p>Its first number is 10, which is old Class A space. Classes came from the first number, not the mask. With CIDR we just say: a /24 network, 256 addresses.</p>}
          />
          <TryList
            items={[
              { text: <>Click Class A, B and C: watch the line jump between /8, /16 and /24.</>, done: !!seen.cA && !!seen.cB && !!seen.cC },
              { text: <>Switch to CIDR and slide the line to a non-class prefix like /23 or /27.</>, done: !!seen.slide },
            ]}
          />
        </>
      }
    />
  );
}

