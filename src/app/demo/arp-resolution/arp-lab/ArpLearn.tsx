"use client";

import { clsx } from "clsx";
import type { ReactNode } from "react";
import type { CliVendor } from "@/lib/cli/types";
import { HOSTS, R1_IFS, type ArpAction, type ArpCapture, type ArpNetState, type ArpPlan, type CacheOwner, type SendDecision } from "@/lib/sim-engine/scenarios/arpNet";
import { CacheTable, CaptureTable, DecisionChain, FrameView, MacTableView, WhoHeard } from "./ArpVisuals";

/**
 * Learn ARP: five levels, one idea at a time, always on the real network. A step can rebuild the network it starts
 * from, play an exchange (pausing at a chosen moment so the learner can look before it continues), and show only the
 * evidence its idea needs. Everything shown is read from the moment the topology is showing.
 */

export type ArpLevel = 1 | 2 | 3 | 4 | 5;
export interface ArpStep {
  id: string;
  title: string;
  body: (v: CliVendor) => ReactNode;
  setup?: ArpAction[];
  /** Start an exchange; `pauseAt` stops the playback at that moment (the learner continues with the next step). */
  run?: { label: string; actions: ArpAction[]; pauseAt?: number };
  /** Continue the exchange already playing, up to `pauseAt` (or the end). */
  resume?: { label: string; pauseAt?: number };
  show: {
    /** Decisions to show: "current" (the wave on the wire) or "all" (every decision of the last exchange). */
    decision?: "current" | "all";
    /** Frame fields: of the wave on the wire, or the latest ARP request / reply / echo of the exchange. */
    frame?: ("current" | "request" | "reply" | "echo" | "echo-r1")[];
    whoHeard?: boolean;
    caches?: CacheOwner[];
    mac?: boolean;
    capture?: { dev: "laptop" | "r1"; iface: "eth0" | "gi0" | "gi1" };
    result?: boolean;
    addresses?: boolean;
  };
}
const FRESH: ArpAction = { type: "fresh" };
const ping = (src: "laptop" | "pcb" | "pcc" | "r1", dst: string): ArpAction => ({ type: "ping", src, dst, count: 1 });
const B = (x: ReactNode) => <b className="text-pv-text">{x}</b>;
const M = (x: ReactNode) => <span className="pv-mono text-pv-text">{x}</span>;
const PCB = HOSTS.pcb.cfg.ip;
const SRV = HOSTS.server.cfg.ip;
const GW = R1_IFS.gi0.ip;

export const ARP_LEVELS: { level: ArpLevel; title: string; idea: string }[] = [
  { level: 1, title: "Why ARP", idea: "An IPv4 packet can't leave without the next hop's MAC address" },
  { level: 2, title: "Request and reply", idea: "A broadcast question, one unicast answer, and who learns what" },
  { level: 3, title: "The cache", idea: "ARP once, then send directly — until the entry goes" },
  { level: 4, title: "Leaving the LAN", idea: "Remote destination: ARP for the gateway, not the destination" },
  { level: 5, title: "When it fails", idea: "What failed resolution looks like, and where to look" },
];

export const ARP_STEPS: Record<ArpLevel, ArpStep[]> = {
  1: [
    {
      id: "l1-need",
      title: "The Laptop knows PC-B's IP. It doesn't know PC-B's MAC.",
      body: () => (
        <>
          <p>The Laptop ({M("192.168.10.10")}) wants to ping PC-B at {M(PCB)}. Both are on the same LAN, wired to SW1. The ping is an IP packet — but on Ethernet every packet travels inside a {B("frame")}, and a frame is delivered by {B("MAC address")}, not by IP.</p>
          <p>The IP part is ready: source {M("192.168.10.10")}, destination {M(PCB)}. The Ethernet destination is blank. The Laptop has never talked to PC-B, so it has no idea which MAC belongs to {M(PCB)}. Until it finds out, the frame cannot leave.</p>
          <p>That gap — IP address known, MAC address unknown — is the whole reason ARP exists.</p>
        </>
      ),
      setup: [FRESH],
      show: { addresses: true },
    },
    {
      id: "l1-watch",
      title: "Watch the Laptop find out",
      body: () => (
        <>
          <p>Ping PC-B and watch. Before anything is sent, the Laptop answers a few questions in order: is PC-B on my network? So who do I send the frame to? Do I already know that device&apos;s MAC?</p>
          <p>Use {B("Pause")} and {B("Step")} under the topology to go one frame at a time.</p>
        </>
      ),
      setup: [FRESH],
      run: { label: "Laptop pings PC-B", actions: [ping("laptop", PCB)] },
      show: { decision: "current", frame: ["current"] },
    },
    {
      id: "l1-sum",
      title: "One question, one answer, then the real packet",
      body: () => (
        <>
          <p>Here is exactly what crossed the Laptop&apos;s network card, in order: its ARP Request went out, PC-B&apos;s ARP Reply came back, and only {B("then")} did the ping leave, now addressed to PC-B&apos;s MAC.</p>
          <p>The Laptop wrote down what it learned: {M(PCB)} is at {M(HOSTS.pcb.mac)}. That entry is the Laptop&apos;s {B("ARP cache")}.</p>
        </>
      ),
      show: { decision: "all", capture: { dev: "laptop", iface: "eth0" }, caches: ["laptop"], result: true },
    },
  ],
  2: [
    {
      id: "l2-ask",
      title: "The question goes to everyone",
      body: () => (
        <>
          <p>The Laptop can&apos;t send its question to PC-B — finding PC-B&apos;s MAC is the problem. So it sends to the {B("broadcast")} MAC {M("FF:FF:FF:FF:FF:FF")}: every device on the LAN receives it.</p>
          <p>Look at the fields: the Laptop puts its own IP and MAC in the sender fields, PC-B&apos;s IP in the target IP, and zeros in the target MAC — the blank it wants filled.</p>
        </>
      ),
      setup: [FRESH],
      run: { label: "Laptop pings PC-B (stops after the broadcast)", actions: [ping("laptop", PCB)], pauseAt: 2 },
      show: { frame: ["request"], whoHeard: true, mac: true },
    },
    {
      id: "l2-who",
      title: "Everyone hears it. Only the owner answers.",
      body: () => (
        <>
          <p>SW1 did what a switch does with any broadcast: it {B("flooded")} it out every other port, without reading the ARP inside. PC-C and R1 kept the frame (it was a broadcast) and read the question: {M(PCB)} isn&apos;t theirs, so they {B("ignored")} it and learned nothing.</p>
          <p>PC-B owns {M(PCB)}. It learns the asker from the sender fields — {M("192.168.10.10")} is at the Laptop&apos;s MAC — and answers {B("by unicast")}, straight to the Laptop&apos;s MAC: no need to bother anyone else.</p>
        </>
      ),
      resume: { label: "Continue: the reply", pauseAt: 4 },
      show: { frame: ["reply"], caches: ["laptop", "pcb", "pcc"] },
    },
    {
      id: "l2-learn",
      title: "Two tables learned, on two different devices",
      body: () => (
        <>
          <p>Both ends of the exchange now know each other: the Laptop learned PC-B from the reply, PC-B learned the Laptop from the request. Neither had to ask twice.</p>
          <p>SW1 learned too, but something else entirely: {B("which port")} each source MAC came in on. Its table has MACs and ports, and {B("no IP address at all")}. ARP caches live in devices that have IP addresses; the switch only moves frames.</p>
        </>
      ),
      resume: { label: "Continue: the ping itself" },
      show: { caches: ["laptop", "pcb"], mac: true, frame: ["echo"] },
    },
  ],
  3: [
    {
      id: "l3-hit",
      title: "The second ping needs no ARP",
      body: () => <p>The Laptop already pinged PC-B once. Ping again and look at the decision: the cache has {M(PCB)}, so the frame is built at once. No broadcast, no question.</p>,
      setup: [FRESH, ping("laptop", PCB)],
      run: { label: "Ping PC-B again", actions: [ping("laptop", PCB)] },
      show: { decision: "current", capture: { dev: "laptop", iface: "eth0" } },
    },
    {
      id: "l3-clear",
      title: "Clear the cache, and the question comes back",
      body: () => <p>Delete the Laptop&apos;s ARP cache ({M("arp -d *")} on Windows) and ping again: cache miss, broadcast, reply, then the ping.</p>,
      setup: [FRESH, ping("laptop", PCB)],
      run: { label: "Clear the Laptop's cache, then ping", actions: [{ type: "clear-cache", owner: "laptop" }, ping("laptop", PCB)] },
      show: { decision: "current", caches: ["laptop"] },
    },
    {
      id: "l3-age",
      title: "Entries don't last forever",
      body: () => (
        <>
          <p>A cache entry is remembered for a while, then dropped: devices can move, change cards, or switch off. In this lab a host forgets an entry {B("120 s")} after it was confirmed (real systems vary from seconds to minutes; routers keep theirs for many minutes).</p>
          <p>Let 125 s pass, then ping: the entry is gone, so the Laptop has to ask again.</p>
        </>
      ),
      setup: [FRESH, ping("laptop", PCB)],
      run: { label: "Wait 125 s, then ping", actions: [{ type: "time", seconds: 125 }, ping("laptop", PCB)] },
      show: { decision: "current", caches: ["laptop"] },
    },
    {
      id: "l3-two",
      title: "Clear the switch instead: the Laptop doesn't care",
      body: () => (
        <>
          <p>This time clear {B("SW1&apos;s MAC table")}, not the Laptop&apos;s cache, then ping. The Laptop still has PC-B in its cache: {B("cache hit, no ARP")}. But SW1 no longer knows where PC-B&apos;s MAC is, so it {B("floods")} the ping like an unknown destination, until PC-B&apos;s reply teaches it again.</p>
          <p>Two tables, two devices, two jobs: the ARP cache answers &quot;which MAC for this IP?&quot;, the MAC table answers &quot;which port for this MAC?&quot;</p>
        </>
      ),
      setup: [FRESH, ping("laptop", PCB)],
      run: { label: "Clear SW1's MAC table, then ping", actions: [{ type: "sw-clear" }, ping("laptop", PCB)] },
      show: { decision: "current", caches: ["laptop"], mac: true },
    },
  ],
  4: [
    {
      id: "l4-remote",
      title: "A destination outside my network",
      body: () => (
        <>
          <p>Now the Laptop pings the Server, {M(SRV)}. With mask {M("255.255.255.0")}, the Laptop&apos;s network is {M("192.168.10.0/24")}. {M(SRV)} is not in it: the Server is {B("remote")}.</p>
          <p>A remote device is never on the Laptop&apos;s wire, so ARPing for it would be pointless: nobody on this LAN owns {M(SRV)}. The Laptop sends remote traffic to its {B("default gateway")}, {M(GW)} — so {B("that")} is the address it ARPs for.</p>
        </>
      ),
      setup: [FRESH],
      run: { label: "Laptop pings the Server (stops when the ping leaves)", actions: [ping("laptop", SRV)], pauseAt: 4 },
      show: { decision: "current", frame: ["request"] },
    },
    {
      id: "l4-split",
      title: "IP says Server. Ethernet says R1.",
      body: () => (
        <>
          <p>Look at the ping as it leaves the Laptop. The {B("IP destination")} is the Server — the final destination, unchanged end to end. The {B("Ethernet destination")} is R1&apos;s MAC — just the next hop on this wire. The {B("ARP target")} was R1&apos;s IP, because R1 is the next hop.</p>
          <p>Nothing in the frame mentions the Server&apos;s MAC. The Laptop never learns it, and never needs it.</p>
        </>
      ),
      resume: { label: "Continue: the frame reaches R1", pauseAt: 6 },
      show: { frame: ["echo"], addresses: true },
    },
    {
      id: "l4-r1",
      title: "R1 does its own ARP, on the other side",
      body: () => (
        <>
          <p>R1 kept the frame (it was addressed to its MAC), read the IP destination and looked it up: {M("10.20.20.0/24")} is connected on its other interface. Now {B("R1")} is the sender with a missing MAC — the Server&apos;s. It asks on the Server&apos;s side; that broadcast never reaches the Laptop&apos;s LAN.</p>
          <p>Then R1 builds a {B("new Ethernet header")} — its own MAC as source, the Server&apos;s as destination — around the same IP packet.</p>
        </>
      ),
      resume: { label: "Continue: R1 forwards", pauseAt: 8 },
      show: { decision: "current", frame: ["echo", "echo-r1"] },
    },
    {
      id: "l4-back",
      title: "The way back, and who knows whom",
      body: () => (
        <>
          <p>The Server answers to its own gateway (R1&apos;s other interface), and R1 sends the reply to the Laptop — it learned the Laptop&apos;s MAC when the Laptop asked for 192.168.10.1.</p>
          <p>Compare the caches: the Laptop knows {B("only R1")}. R1 knows both sides. The Server knows only R1. ARP is always about the next hop on {B("one")} link.</p>
        </>
      ),
      resume: { label: "Continue to the end" },
      show: { caches: ["laptop", "r1", "server"], result: true },
    },
  ],
  5: [
    {
      id: "l5-nobody",
      title: "Nobody owns the address",
      body: () => (
        <>
          <p>Ping {M("192.168.10.99")} — a local address no device has. The broadcast reaches everyone, everyone ignores it, and no reply ever comes. The Laptop keeps an {B("incomplete")} entry and Windows prints {M("Destination host unreachable")} — reported by the Laptop itself, from its own address.</p>
          <p>Notice that {M("arp -a")} won&apos;t list a failed entry; {M("netsh interface ipv4 show neighbors")} will.</p>
        </>
      ),
      setup: [FRESH],
      run: { label: "Laptop pings 192.168.10.99", actions: [ping("laptop", "192.168.10.99")] },
      show: { decision: "all", whoHeard: true, caches: ["laptop"], result: true },
    },
    {
      id: "l5-remote",
      title: "Remote, and the host is missing: look elsewhere",
      body: () => (
        <>
          <p>Ping {M("10.20.20.99")}. The Laptop&apos;s part works: it resolves its gateway and sends the ping to R1. It is {B("R1")} whose ARP for {M("10.20.20.99")} gets no answer, so the Laptop just sees {M("Request timed out")}.</p>
          <p>The lesson: the failing ARP is always on the {B("last link")}. A healthy gateway entry on the Laptop doesn&apos;t mean the destination is reachable — check the device that delivers to it.</p>
        </>
      ),
      setup: [FRESH],
      run: { label: "Laptop pings 10.20.20.99", actions: [ping("laptop", "10.20.20.99")] },
      show: { decision: "all", caches: ["laptop", "r1"], result: true },
    },
    {
      id: "l5-gw",
      title: "A wrong gateway: remote traffic asks for nobody",
      body: () => (
        <>
          <p>Someone typed the Laptop&apos;s gateway as {M("192.168.10.254")}. Ping the Server. The Laptop correctly decides &quot;remote&quot; and correctly ARPs for its gateway — an address no device owns. The broadcast reaches everyone, nobody answers, and the Laptop reports {M("Destination host unreachable")} itself.</p>
          <p>R1 is fine, the Server is fine: look at the ARP target in the Laptop&apos;s decision.</p>
        </>
      ),
      setup: [FRESH, { type: "host-cfg", host: "laptop", cfg: { ip: "192.168.10.10", prefix: 24, gw: "192.168.10.254" } }],
      run: { label: "Ping the Server", actions: [ping("laptop", SRV)] },
      show: { decision: "all", whoHeard: true, caches: ["laptop"], result: true },
    },
    {
      id: "l5-local",
      title: "…while everything local still works",
      body: () => (
        <>
          <p>Same Laptop, same wrong gateway: ping PC-B. It works, because local traffic never involves the gateway. &quot;Some things work, others don&apos;t&quot; is a clue in itself.</p>
          <p>That&apos;s the reasoning you&apos;ll use from now on: {B("what IP is it trying to reach → local or remote → so what should it ARP for → is there an entry → was a request sent → who saw it → did anyone reply → what was learned")}.</p>
        </>
      ),
      run: { label: "Ping PC-B", actions: [ping("laptop", PCB)] },
      show: { decision: "all", caches: ["laptop"], result: true },
    },
  ],
};

/** The four addresses that answer "where does this frame go?" — for the packet on the wire. */
function AddressTable({ view }: { view: ArpNetState }) {
  const echo = [...view.captures].reverse().find((c) => c.dev === "laptop" && c.dir === "out" && c.frame.ip?.icmp === "echo-request");
  const rows: [string, string, string][] = echo
    ? [
        ["IP destination", echo.frame.ip!.dst, "where the packet must end up · never changes"],
        ["Next hop", echo.frame.ip!.dst === echo.frame.ethDst ? echo.frame.ip!.dst : view.cfg.laptop.gw && echo.frame.ethDst === R1_IFS.gi0.mac ? view.cfg.laptop.gw : echo.frame.ip!.dst, "who gets this frame on this wire"],
        ["ARP target", echo.frame.ethDst === R1_IFS.gi0.mac ? R1_IFS.gi0.ip : echo.frame.ip!.dst, "the next hop's IP: what the Laptop asked about"],
        ["Ethernet destination", echo.frame.ethDst, "the next hop's MAC, from the ARP cache"],
      ]
    : [
        ["IP destination", PCB, "known: the Laptop was told where to send"],
        ["Next hop", PCB, "local, so PC-B itself"],
        ["ARP target", PCB, "the next hop's IP"],
        ["Ethernet destination", "??:??:??:??:??:??", "unknown: nothing can be sent yet"],
      ];
  return (
    <table className="w-full text-left text-[12px]">
      <tbody>
        {rows.map(([k, v, w]) => (
          <tr key={k} className="border-t border-pv-border/50 align-top">
            <td className="py-1 pr-2 font-semibold text-pv-text">{k}</td>
            <td className={clsx("py-1 pr-2 pv-mono", v.startsWith("??") ? "text-pv-warning" : "text-pv-text")}>{v}</td>
            <td className="py-1 text-pv-text-muted">{w}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const H = ({ children }: { children: ReactNode }) => <p className="text-[10.5px] font-bold uppercase tracking-wide text-pv-text-faint">{children}</p>;
const latest = (view: ArpNetState, run: number, f: (c: ArpCapture) => boolean) => [...view.captures].reverse().find((c) => c.run === run && f(c));

export function ArpStepView({ step, view, plan, cursor, vendor, ran }: { step: ArpStep; view: ArpNetState; plan?: ArpPlan; cursor: number; vendor: CliVendor; ran: boolean }) {
  const playing = !!plan && cursor < plan.waves.length;
  const wave = plan && playing ? plan.waves[cursor] : undefined;
  const run = plan?.run ?? view.run;
  const showRun = ran && !!plan;
  const fin = plan?.snaps[plan.snaps.length - 1];
  const result = fin?.last?.type === "ping" ? fin.last.result : undefined;
  // one entry per decision (sender + packet), in order, each as it stands at the moment shown
  const byKey = new Map<string, SendDecision>();
  if (plan) for (const w of plan.waves.slice(0, Math.min(cursor + 1, plan.waves.length))) if (w.decision) byKey.set(`${w.decision.dev}|${w.decision.src}|${w.decision.dst}`, w.decision);
  const allDecisions: SendDecision[] = [...byKey.values()];
  // the decision to show: the one on the wire, or (once it's over) the original sender's
  const current = wave ? (wave.decision ?? allDecisions[allDecisions.length - 1]) : (allDecisions.find((d) => d.dev === result?.src) ?? allDecisions[0]);
  const frames = (step.show.frame ?? []).map((k) => {
    if (!showRun) return undefined;
    if (k === "current") return wave?.copies[0]?.frame;
    if (k === "request") return latest(view, run, (c) => c.dir === "out" && c.frame.arp?.op === "request" && c.dev !== "sw1")?.frame;
    if (k === "reply") return latest(view, run, (c) => c.dir === "out" && c.frame.arp?.op === "reply" && c.dev !== "sw1")?.frame;
    if (k === "echo") return latest(view, run, (c) => c.dir === "out" && c.dev === "laptop" && c.frame.ip?.icmp === "echo-request")?.frame;
    return latest(view, run, (c) => c.dir === "out" && c.dev === "r1" && c.iface === "gi1" && c.frame.ip?.icmp === "echo-request")?.frame;
  });
  const req = showRun ? latest(view, run, (c) => c.dir === "out" && c.frame.arp?.op === "request" && c.dev !== "sw1") : undefined;
  return (
    <div className="space-y-2.5">
      <div className="space-y-1.5 text-[13.5px] leading-relaxed text-pv-text-muted">{step.body(vendor)}</div>
      {wave && <p className="rounded-lg border border-pv-cyan/40 bg-pv-cyan/[0.06] px-2 py-1 text-[12.5px] text-pv-text">▶ {wave.caption}</p>}
      {step.show.addresses && (
        <div className="space-y-1 rounded-xl border border-pv-border p-2">
          <H>Where does the frame go?</H>
          <AddressTable view={view} />
        </div>
      )}
      {step.show.decision === "current" && showRun && current && (
        <div className="space-y-1">
          <H>Before sending, the sender decides</H>
          <DecisionChain d={current} />
        </div>
      )}
      {step.show.decision === "all" && showRun && allDecisions.length > 0 && (
        <div className="space-y-2">
          <H>Every decision in this exchange</H>
          {allDecisions.map((d, i) => (
            <DecisionChain key={i} d={d} compact />
          ))}
        </div>
      )}
      {frames.some(Boolean) && (
        <div className={clsx("grid gap-2", frames.filter(Boolean).length > 1 && "lg:grid-cols-2")}>
          {frames.map((f, i) => f && <FrameView key={i} f={f} note={(step.show.frame ?? [])[i] === "echo-r1" ? "Rebuilt by R1: new Ethernet header, same IP packet (TTL −1)." : undefined} />)}
        </div>
      )}
      {step.show.whoHeard && req && (
        <div className="space-y-1">
          <H>Who received the request, and what each did</H>
          <WhoHeard s={view} run={run} tip={req.frame.arp!.tip} />
        </div>
      )}
      {step.show.capture && showRun && (
        <div className="space-y-1">
          <H>Capture on the {step.show.capture.dev === "laptop" ? "Laptop's eth0" : `R1 ${step.show.capture.iface}`}</H>
          <CaptureTable s={view} dev={step.show.capture.dev} iface={step.show.capture.iface} vendor={vendor} />
        </div>
      )}
      {((step.show.caches?.length ?? 0) > 0 || step.show.mac) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {step.show.caches?.map((o) => <CacheTable key={o} s={view} owner={o} />)}
          {step.show.mac && <MacTableView s={view} vendor={vendor} />}
        </div>
      )}
      {step.show.result && result && !playing && (
        <p className={clsx("pv-pop rounded-lg border px-2 py-1 text-[12.5px]", result.replies.every((r) => r.kind === "reply") ? "border-pv-success/50 text-pv-success" : "border-pv-warning/50 text-pv-warning")}>
          Result: {result.replies.map((r) => (r.kind === "reply" ? `reply from ${r.from}` : r.kind === "host-unreachable" ? "Destination host unreachable (no ARP reply)" : r.kind === "net-unreachable" ? "Destination net unreachable (from R1)" : r.kind === "no-route" ? "not sent (no route)" : "Request timed out")).join(" · ")}
        </p>
      )}
    </div>
  );
}
