"use client";

import { clsx } from "clsx";
import { useState, type ReactNode } from "react";
import type { CliVendor } from "@/lib/cli/types";
import { networkOf } from "@/lib/sim-engine/scenarios/ipv4Basics";
import { V4_HOSTS, type V4Action, type V4CacheOwner, type V4Decision, type V4NetState, type V4Plan } from "@/lib/sim-engine/scenarios/ipv4Net";
import { AddressChain, AddressLens, CacheTable, CaptureTable, DecisionMath, FrameView, HeaderDiff, NetworkStrip, RouterPipeline } from "./V4Visuals";

/**
 * Learn IPv4: five levels, one idea at a time, on the real network. A step can rebuild the network it starts from and
 * play an exchange, pausing at a chosen moment. Everything shown is read from the moment the topology is showing.
 */

export type V4Level = 1 | 2 | 3 | 4 | 5;
export interface V4Step {
  id: string;
  title: string;
  body: (v: CliVendor) => ReactNode;
  setup?: V4Action[];
  run?: { label: string; actions: V4Action[]; pauseAt?: number };
  resume?: { label: string; pauseAt?: number };
  show: {
    lens?: "hosta";
    strip?: "hosta" | "hostb";
    playground?: boolean;
    math?: "first" | "hostb";
    chain?: boolean;
    frame?: ("current" | "echo-a" | "echo-r1")[];
    pipeline?: boolean;
    diff?: boolean;
    caches?: V4CacheOwner[];
    capture?: "hosta" | "hostb";
    result?: boolean;
  };
}
const FRESH: V4Action = { type: "fresh" };
const ping = (src: "hosta" | "hostc" | "hostb", dst: string, ttl?: number): V4Action => ({ type: "ping", src, dst, count: 1, ttl });
const B = (x: ReactNode) => <b className="text-pv-text">{x}</b>;
const M = (x: ReactNode) => <span className="pv-mono text-pv-text">{x}</span>;
const A_IP = "192.168.10.10", C_IP = "192.168.10.30", B_IP = "192.168.10.70";

export const V4_LEVELS: { level: V4Level; title: string; idea: string }[] = [
  { level: 1, title: "Address and prefix", idea: "An address says which network a device is on; the prefix says where that network ends" },
  { level: 2, title: "Local or remote", idea: "Every packet starts with one AND: deliver it myself, or hand it to the gateway" },
  { level: 3, title: "Through R1", idea: "A router keeps the IPv4 packet and replaces the Ethernet frame around it" },
  { level: 4, title: "TTL and checksum", idea: "The two header fields a router must change, and why" },
  { level: 5, title: "Wrong settings", idea: "A host's own mask and gateway decide where its packets can go" },
];

export const V4_STEPS: Record<V4Level, V4Step[]> = {
  1: [
    {
      id: "l1-address",
      title: "An address is a network number and a host number",
      body: () => (
        <>
          <p>HOST-A is {M("192.168.10.10/26")}. An IPv4 address is 32 bits. The {M("/26")} — the {B("prefix")} — says the first 26 bits name the {B("network")}; the remaining 6 bits name one {B("host")} on it.</p>
          <p>Everything with the same first 26 bits is on HOST-A&apos;s network: {M("192.168.10.0")} to {M("192.168.10.63")}. The mask {M("255.255.255.192")} is the same /26 written as bits: 26 ones, then zeros.</p>
        </>
      ),
      setup: [FRESH],
      show: { lens: "hosta" },
    },
    {
      id: "l1-who",
      title: "Who shares HOST-A's network?",
      body: () => (
        <>
          <p>Put every device on the line of addresses. HOST-C ({M(C_IP)}) and R1&apos;s left interface ({M(".1")}) fall inside HOST-A&apos;s block: same network, same wire. HOST-B ({M(B_IP)}) falls in the next block, {M("192.168.10.64/26")} — a different network, on the other side of R1.</p>
          <p>Notice the bottom row: R1 has one interface in each network. A router is exactly that — a device with a foot in several networks.</p>
        </>
      ),
      show: { strip: "hosta" },
    },
    {
      id: "l1-prefix",
      title: "The prefix draws the line",
      body: () => (
        <>
          <p>The prefix is HOST-A&apos;s {B("own setting")}. Move it and HOST-A&apos;s idea of its network moves with it — the devices don&apos;t move at all.</p>
          <p>Try {M("/24")}: suddenly HOST-B looks local. Try {M("/28")}: HOST-C looks remote. Nothing about the cables changed; only what HOST-A believes. Remember this — it is the wrong-mask incident in one slider.</p>
        </>
      ),
      show: { playground: true },
    },
  ],
  2: [
    {
      id: "l2-local",
      title: "HOST-A → HOST-C: same network",
      body: () => (
        <>
          <p>Before sending anything, HOST-A masks {B("both")} addresses with {B("its own")} mask and compares the results. Same network number → {B("local")}: HOST-C is on HOST-A&apos;s own wire, so HOST-A delivers the packet itself.</p>
          <p>Ping HOST-C and look at the frame: Ethernet destination = HOST-C&apos;s MAC, IPv4 destination = HOST-C. No router involved.</p>
        </>
      ),
      setup: [FRESH],
      run: { label: "HOST-A pings HOST-C", actions: [ping("hosta", C_IP)] },
      show: { math: "first", chain: true, frame: ["echo-a"] },
    },
    {
      id: "l2-remote",
      title: "HOST-A → HOST-B: a different network",
      body: () => (
        <>
          <p>Same calculation, different answer: {M(`${B_IP} AND 255.255.255.192 = 192.168.10.64`)}, not HOST-A&apos;s {M("192.168.10.0")}. HOST-B is {B("remote")} — not on HOST-A&apos;s wire, so HOST-A can&apos;t reach it directly.</p>
          <p>HOST-A sends remote packets to its {B("default gateway")}, {M("192.168.10.1")}. Watch until the ping leaves HOST-A.</p>
        </>
      ),
      setup: [FRESH],
      run: { label: "HOST-A pings HOST-B (stops as the ping leaves)", actions: [ping("hosta", B_IP)], pauseAt: 4 },
      show: { math: "first", chain: true, frame: ["echo-a"] },
    },
    {
      id: "l2-gateway",
      title: "The gateway is just an address — R1's",
      body: () => (
        <>
          <p>The default gateway is the address of the router interface on HOST-A&apos;s network. HOST-A needed its MAC, so it ARPed for {M("192.168.10.1")} — {B("not")} for HOST-B. You know why from the ARP lesson: ARP only works on your own wire, and HOST-B isn&apos;t on it.</p>
          <p>So the ping leaves with two different destinations: the {B("IPv4 destination")} is HOST-B (the final host), the {B("Ethernet destination")} is R1 (the next hop on this wire).</p>
        </>
      ),
      show: { frame: ["echo-a"], caches: ["hosta"] },
    },
  ],
  3: [
    {
      id: "l3-r1",
      title: "Inside R1",
      body: () => (
        <>
          <p>The frame reaches R1 addressed to R1&apos;s own MAC, so R1 takes it. Then it does what every router does, in this order: throw away the Ethernet header, read the IPv4 destination, look it up, take 1 off the TTL, recompute the checksum, find the next hop&apos;s MAC — here by ARP on LAN B — and wrap the packet in a {B("new")} frame.</p>
        </>
      ),
      setup: [FRESH],
      run: { label: "HOST-A pings HOST-B (stops when R1 forwards)", actions: [ping("hosta", B_IP)], pauseAt: 10 },
      show: { pipeline: true },
    },
    {
      id: "l3-diff",
      title: "Same packet, new frame",
      body: () => (
        <>
          <p>Compare the packet arriving at R1 with the one leaving. The IPv4 source and destination are {B("identical")}: they name the two ends of the conversation. The Ethernet addresses are {B("all new")}: they only ever name the two ends of {B("one wire")}. TTL and checksum changed — level 4 is about those.</p>
        </>
      ),
      show: { diff: true },
    },
    {
      id: "l3-back",
      title: "The reply makes its own decision",
      body: () => (
        <>
          <p>HOST-B answers. It runs the same AND with {B("its")} address and mask: {M(A_IP)} is not on {M("192.168.10.64/26")}, so the reply goes to {B("HOST-B&apos;s")} gateway, {M("192.168.10.65")} — R1&apos;s other interface. Every direction is a separate decision by a separate host.</p>
        </>
      ),
      resume: { label: "Continue: the reply" },
      show: { math: "hostb", caches: ["hosta", "r1", "hostb"], result: true },
    },
  ],
  4: [
    {
      id: "l4-ttl",
      title: "TTL: a packet's remaining lifetime",
      body: () => (
        <>
          <p>Every router takes 1 off the {B("TTL")} (time to live). A router that would send it with TTL 0 drops it instead and tells the sender ({M("time exceeded")}). That&apos;s what stops a packet circling forever if routers ever disagree about the way.</p>
          <p>HOST-A sends this ping with TTL {B("1")}. Watch R1.</p>
        </>
      ),
      setup: [FRESH],
      run: { label: "HOST-A pings HOST-B with TTL 1", actions: [ping("hosta", B_IP, 1)] },
      show: { pipeline: true, result: true },
    },
    {
      id: "l4-checksum",
      title: "The checksum follows the TTL",
      body: () => (
        <>
          <p>The {B("header checksum")} protects the IPv4 header against corruption: the sender adds up the header&apos;s 16-bit words and stores the result; every receiver checks it. Change one field — the TTL — and the old checksum is wrong, so R1 recomputes it.</p>
          <p>Ping normally and look at both fields leaving R1: TTL one less, a different checksum. The addresses, the identification and the length — the rest of the header — untouched.</p>
        </>
      ),
      setup: [FRESH],
      run: { label: "HOST-A pings HOST-B", actions: [ping("hosta", B_IP)], pauseAt: 10 },
      show: { diff: true, frame: ["echo-r1"] },
    },
  ],
  5: [
    {
      id: "l5-mask",
      title: "A wrong mask: HOST-A decides wrongly",
      body: () => (
        <>
          <p>Someone typed HOST-A&apos;s mask as {M("255.255.255.0")} (/24). Now {M(`${B_IP} AND 255.255.255.0 = 192.168.10.0`)} — the same as HOST-A&apos;s network. HOST-A concludes HOST-B is {B("local")} and ARPs for {M(B_IP)} itself, on LAN A, where nobody has that address. R1 hears the question and stays silent: it only answers for its own addresses.</p>
          <p>Nothing is wrong with R1, the cables or HOST-B. HOST-A&apos;s belief about its own network is wrong.</p>
        </>
      ),
      setup: [FRESH, { type: "host-cfg", host: "hosta", cfg: { ip: A_IP, prefix: 24, gw: "192.168.10.1" } }],
      run: { label: "HOST-A pings HOST-B", actions: [ping("hosta", B_IP)] },
      show: { math: "first", chain: true, strip: "hosta", result: true },
    },
    {
      id: "l5-gateway",
      title: "A wrong gateway: right decision, wrong door",
      body: () => (
        <>
          <p>Mask fixed, but the gateway is now {M("192.168.10.2")}. HOST-A decides {B("remote")} correctly — and ARPs for a gateway nobody owns. Every remote packet is stuck; HOST-C still works, because local packets never use the gateway.</p>
        </>
      ),
      setup: [FRESH, { type: "host-cfg", host: "hosta", cfg: { ip: A_IP, prefix: 26, gw: "192.168.10.2" } }],
      run: { label: "HOST-A pings HOST-B", actions: [ping("hosta", B_IP)] },
      show: { math: "first", chain: true, result: true },
    },
    {
      id: "l5-return",
      title: "The way back is someone else's settings",
      body: () => (
        <>
          <p>Everything on HOST-A is correct now. But HOST-B has {B("no default gateway")}. HOST-A&apos;s ping reaches HOST-B — its capture shows it — and HOST-B can&apos;t answer: the reply is for a remote address and HOST-B has nowhere to send it. HOST-A just times out.</p>
          <p>That&apos;s the reasoning you&apos;ll use from now on: {B("what are the host's IP, mask and gateway → local or remote → whom did it try to reach on the wire → did the packet reach R1 → what did R1 do → did the reply come back")} — each step proved by evidence.</p>
        </>
      ),
      setup: [FRESH, { type: "host-cfg", host: "hostb", cfg: { ip: B_IP, prefix: 26 } }],
      run: { label: "HOST-A pings HOST-B", actions: [ping("hosta", B_IP)] },
      show: { math: "hostb", capture: "hostb", result: true },
    },
  ],
};

/** UI-only: drag HOST-A's prefix and watch what HOST-A would believe (the network itself is not changed). */
function PrefixPlayground({ s }: { s: V4NetState }) {
  const [p, setP] = useState(26);
  const verdict = (ip: string) => (networkOf(ip, p) === networkOf(A_IP, p) ? "local" : "remote");
  return (
    <div className="space-y-2 rounded-xl border border-pv-violet/40 bg-pv-violet/[0.04] p-2">
      <label className="flex flex-wrap items-center gap-2 text-[12.5px] text-pv-text">
        HOST-A&apos;s prefix
        <input type="range" min={22} max={30} value={p} onChange={(e) => setP(+e.target.value)} aria-label="HOST-A prefix" className="w-40 accent-cyan-400" />
        <span className="pv-mono font-bold text-pv-cyan-soft">/{p}</span>
        {p !== 26 && (
          <button type="button" onClick={() => setP(26)} className="rounded-full border border-pv-border px-2 py-0.5 text-[11px] text-pv-text-muted hover:text-pv-text">
            back to /26
          </button>
        )}
      </label>
      <AddressLens ip={A_IP} prefix={p} name="HOST-A" />
      <NetworkStrip s={s} owner="hosta" prefixOverride={p} />
      <p className="text-[12px] text-pv-text-muted">
        With /{p}, HOST-A would treat HOST-C as <b className={verdict(C_IP) === "local" ? "text-pv-success" : "text-pv-warning"}>{verdict(C_IP)}</b> and HOST-B as <b className={verdict(B_IP) === "local" ? "text-pv-success" : "text-pv-warning"}>{verdict(B_IP)}</b>
        {verdict(B_IP) === "local" ? " — wrongly: HOST-B is behind R1." : verdict(C_IP) === "remote" ? " — HOST-C would be sent to the gateway though it sits on the same switch." : " — which matches the real networks."}
      </p>
    </div>
  );
}

const H = ({ children }: { children: ReactNode }) => <p className="text-[10.5px] font-bold uppercase tracking-wide text-pv-text-faint">{children}</p>;

export function V4StepView({ step, view, plan, cursor, vendor, ran }: { step: V4Step; view: V4NetState; plan?: V4Plan; cursor: number; vendor: CliVendor; ran: boolean }) {
  const playing = !!plan && cursor < plan.waves.length;
  const wave = playing ? plan!.waves[cursor] : undefined;
  const showRun = ran && !!plan;
  const fin = plan?.snaps[plan.snaps.length - 1];
  const result = fin?.last?.type === "ping" ? fin.last.result : undefined;
  const upto = plan ? plan.waves.slice(0, Math.min(cursor + 1, plan.waves.length)) : [];
  const decisions: V4Decision[] = [];
  for (const w of upto) if (w.decision) {
    const i = decisions.findIndex((d) => d.dev === w.decision!.dev && d.dst === w.decision!.dst && d.src === w.decision!.src);
    if (i >= 0) decisions[i] = w.decision;
    else decisions.push(w.decision);
  }
  const first = decisions.find((d) => d.dev === result?.src) ?? decisions[0];
  const hostb = decisions.find((d) => d.dev === "hostb");
  const current = wave?.decision ?? first;
  const router = [...upto].reverse().find((w) => w.router)?.router;
  const run = plan?.run ?? view.run;
  const capOf = (f: (c: V4NetState["captures"][number]) => boolean) => [...view.captures].reverse().find((c) => c.run === run && f(c))?.frame;
  const frames = (step.show.frame ?? []).map((k) => (!showRun ? undefined : k === "current" ? wave?.copies[0]?.frame : k === "echo-a" ? capOf((c) => c.dev === (result?.src ?? "hosta") && c.dir === "out" && c.frame.ip?.icmp === "echo-request") : capOf((c) => c.dev === "r1" && c.dir === "out" && c.frame.ip?.icmp === "echo-request")));
  return (
    <div className="space-y-2.5">
      <div className="space-y-1.5 text-[13.5px] leading-relaxed text-pv-text-muted">{step.body(vendor)}</div>
      {wave && <p className="rounded-lg border border-pv-cyan/40 bg-pv-cyan/[0.06] px-2 py-1 text-[12.5px] text-pv-text">▶ {wave.caption}</p>}
      {step.show.lens && <AddressLens ip={view.cfg.hosta.ip} prefix={view.cfg.hosta.prefix} name="HOST-A" />}
      {step.show.playground && <PrefixPlayground s={view} />}
      {step.show.strip && <NetworkStrip s={view} owner={step.show.strip} />}
      {step.show.math === "first" && showRun && first && <DecisionMath d={first} name={V4_HOSTS[first.dev as "hosta"]?.name ?? "R1"} />}
      {step.show.math === "hostb" && showRun && hostb && <DecisionMath d={hostb} name="HOST-B" />}
      {step.show.chain && showRun && current && (
        <div className="space-y-1">
          <H>Where the frame goes</H>
          <AddressChain d={current} />
        </div>
      )}
      {step.show.pipeline && showRun && router && (
        <div className="space-y-1">
          <H>Inside R1, for this packet</H>
          <RouterPipeline r={router} vendor={vendor} />
        </div>
      )}
      {step.show.diff && showRun && router?.outFrame && (
        <div className="space-y-1">
          <H>The packet arriving at R1 vs leaving R1</H>
          <HeaderDiff inF={router.inFrame} outF={router.outFrame} />
        </div>
      )}
      {frames.some(Boolean) && (
        <div className={clsx("grid gap-2", frames.filter(Boolean).length > 1 && "lg:grid-cols-2")}>
          {frames.map((f, i) => f && <FrameView key={i} f={f} />)}
        </div>
      )}
      {step.show.capture && showRun && (
        <div className="space-y-1">
          <H>Capture on {V4_HOSTS[step.show.capture].name}</H>
          <CaptureTable s={view} dev={step.show.capture} iface="eth0" vendor={vendor} />
        </div>
      )}
      {step.show.caches && (
        <div className="grid gap-2 sm:grid-cols-3">
          {step.show.caches.map((o) => (
            <CacheTable key={o} s={view} owner={o} />
          ))}
        </div>
      )}
      {step.show.result && result && !playing && (
        <p className={clsx("pv-pop rounded-lg border px-2 py-1 text-[12.5px]", result.replies.every((r) => r.kind === "reply") ? "border-pv-success/50 text-pv-success" : "border-pv-warning/50 text-pv-warning")}>
          Result:{" "}
          {result.replies
            .map((r) => (r.kind === "reply" ? `reply from ${r.from}, TTL ${r.ttl}` : r.kind === "host-unreachable" ? "Destination Host Unreachable (no ARP reply for the next hop)" : r.kind === "net-unreachable" ? `Destination Net Unreachable (from ${r.from})` : r.kind === "ttl-expired" ? `Time to live exceeded (from ${r.from})` : r.kind === "no-route" ? "not sent: Network is unreachable" : "no reply — timed out"))
            .join(" · ")}
        </p>
      )}
    </div>
  );
}
