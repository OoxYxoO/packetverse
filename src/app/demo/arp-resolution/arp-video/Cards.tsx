"use client";

import { clsx } from "clsx";
import type { ReactNode } from "react";
import { BCAST, HOSTS, ZERO_MAC, macOwner } from "@/lib/sim-engine/scenarios/arpNet";
import { PLANS, waveFrame, type Card } from "./screenplay";

/**
 * The cards that appear over the picture while the narrator talks about them — a frame being built, a device's
 * memory, broadcast vs unicast, the next hop, the router rebuilding a frame. HTML (not SVG) so the text keeps a real,
 * readable size on a phone. Every value comes from the ARP model's waves and snapshots.
 */

const Mono = ({ children, className }: { children: ReactNode; className?: string }) => <span className={clsx("pv-mono", className)}>{children}</span>;
const shortMac = (m: string) => (m === BCAST ? "FF:FF:FF:FF:FF:FF" : m);

function Shell({ title, children, tone = "cyan" }: { title: string; children: ReactNode; tone?: "cyan" | "violet" | "amber" | "green" }) {
  const border = { cyan: "border-cyan-400/40", violet: "border-violet-400/40", amber: "border-amber-400/50", green: "border-emerald-400/50" }[tone];
  const text = { cyan: "text-cyan-200", violet: "text-violet-200", amber: "text-amber-200", green: "text-emerald-200" }[tone];
  return (
    <div className={clsx("pv-v-card rounded-2xl border bg-[#070c18]/92 p-3 shadow-2xl shadow-black/60 backdrop-blur-sm sm:p-4", border)}>
      <p className={clsx("mb-2 text-[11px] font-bold uppercase tracking-[0.14em] sm:text-xs", text)}>{title}</p>
      {children}
    </div>
  );
}

function Field({ k, v, state, sub }: { k: string; v: ReactNode; state?: "glow" | "check" | "unknown" | "plain"; sub?: string }) {
  return (
    <div
      className={clsx(
        "min-w-0 rounded-xl border px-2.5 py-1.5 transition-all duration-500",
        state === "glow" && "border-amber-300 bg-amber-300/10 shadow-[0_0_24px_rgba(251,191,36,.35)]",
        state === "check" && "border-emerald-400/80 bg-emerald-400/10",
        state === "unknown" && "border-dashed border-amber-300/80 bg-amber-300/5",
        (!state || state === "plain") && "border-white/10 bg-white/[0.03]",
      )}
    >
      <p className="flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 sm:text-[11px]">
        {k}
        {state === "check" && <span className="text-emerald-300">✓ known</span>}
      </p>
      <p className="break-all text-[14px] leading-snug text-slate-50 sm:text-[15px]">{v}</p>
      {sub && <p className="text-[11px] text-slate-400 sm:text-xs">{sub}</p>}
    </div>
  );
}

function FrameCard({ c }: { c: Extract<Card, { k: "frame" }> }) {
  const f = waveFrame(c.plan, c.wave);
  const stage = c.stage ?? "full";
  // "known" wins over a plain highlight: the correction shows WHICH field was already filled in
  const st = (k: "dstMac" | "dstIp" | "srcMac" | "srcIp" | "question" | "target"): "glow" | "check" | undefined => (c.check?.includes(k as "dstIp" | "srcMac") ? "check" : c.glow?.includes(k) ? "glow" : undefined);
  const arp = f.arp;
  const title = arp ? (arp.op === "request" ? "ARP Request" : "ARP Reply") : f.ip!.icmp === "echo-request" ? "Ping" : "Echo reply";
  return (
    <Shell title={stage === "ip" ? "The packet" : `The frame · ${title}`} tone={arp ? "amber" : "cyan"}>
      {stage !== "ip" && (
        <div className="pv-v-in mb-2 rounded-xl border border-cyan-400/30 bg-cyan-400/[0.04] p-2">
          <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-cyan-300 sm:text-[11px]">Ethernet · who gets this frame next</p>
          <div className="grid grid-cols-2 gap-1.5">
            {c.mask ? (
              <Field k="To (MAC)" v={<Mono className="text-amber-200">?? unknown ??</Mono>} state={st("dstMac") ?? "unknown"} />
            ) : (
              <Field k="To (MAC)" v={<Mono>{shortMac(f.ethDst)}</Mono>} state={st("dstMac")} sub={f.ethDst === BCAST ? "broadcast: everyone" : macOwner(f.ethDst)} />
            )}
            <Field k="From (MAC)" v={<Mono>{f.ethSrc}</Mono>} state={st("srcMac")} sub={macOwner(f.ethSrc)} />
          </div>
        </div>
      )}
      {arp ? (
        <div className="rounded-xl border border-violet-400/30 bg-violet-400/[0.05] p-2">
          <p className={clsx("rounded-lg px-2 py-1.5 text-[15px] font-semibold leading-snug text-violet-50 transition-all duration-500 sm:text-base", st("question") === "glow" && "bg-violet-400/15 shadow-[0_0_24px_rgba(167,139,250,.35)]")}>
            {arp.op === "request" ? (
              <>
                “Who has <Mono>{arp.tip}</Mono>? Tell <Mono>{arp.sip}</Mono>.”
              </>
            ) : (
              <>
                “<Mono>{arp.sip}</Mono> is at <Mono>{arp.smac}</Mono>.”
              </>
            )}
          </p>
          {arp.op === "request" && (
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <Field k="Sender MAC" v={<Mono>{arp.smac}</Mono>} sub="who's asking" />
              <Field k="Target MAC" v={<Mono>{arp.tmac}</Mono>} state={st("target")} sub={arp.tmac === ZERO_MAC ? "unknown: the question" : undefined} />
            </div>
          )}
        </div>
      ) : (
        <div className={clsx("rounded-xl border border-violet-400/30 bg-violet-400/[0.05] p-2", stage === "ip" && "pv-v-in")}>
          <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-violet-300 sm:text-[11px]">IP packet · where it finally goes</p>
          <div className="grid grid-cols-2 gap-1.5">
            <Field k="From (IP)" v={<Mono>{f.ip!.src}</Mono>} state={st("srcIp")} />
            <Field k="To (IP)" v={<Mono>{f.ip!.dst}</Mono>} state={st("dstIp")} />
          </div>
        </div>
      )}
    </Shell>
  );
}

function MemoryCard({ c }: { c: Extract<Card, { k: "memory" }> }) {
  const s = PLANS[c.plan].snaps[c.snap];
  const rows = s.caches[c.owner].filter((e) => e.state === "reachable");
  const who = c.owner === "r1" ? "The router" : c.owner === "laptop" ? "The Laptop" : c.owner === "pcb" ? "PC-B" : HOSTS[c.owner].name;
  if (c.table)
    return (
      <Shell title={`${who}'s ARP cache · the notes, in networking terms`} tone="green">
        <table className="w-full text-left text-[14px] sm:text-[15px]">
          <thead className="text-[11px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="pb-1 font-semibold">IP address</th>
              <th className="pb-1 font-semibold">MAC address</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.ip} className="pv-v-in">
                <td className="pr-3 pv-mono text-emerald-100">{e.ip}</td>
                <td className="pv-mono text-emerald-100">{e.mac}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Shell>
    );
  if (c.sticky)
    return (
      <div className="pv-v-card relative rotate-[-1.5deg] rounded-md bg-[#fde047] p-3 text-[#422006] shadow-2xl shadow-black/60 transition-all duration-700 sm:p-4">
        <p className="mb-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-[#713f12] sm:text-xs">📝 {who}&apos;s notes</p>
        <div className="grid gap-1">
          {rows.map((e) => (
            <p key={e.ip} className="pv-v-in text-[16px] font-bold sm:text-[17px]">
              <Mono>{e.ip}</Mono> → <Mono>{e.mac}</Mono>
            </p>
          ))}
          {c.ask && !rows.some((e) => e.ip === c.ask) && (
            <p className="text-[16px] font-bold opacity-80 sm:text-[17px]">
              <Mono>{c.ask}</Mono> → <Mono>??</Mono> <span className="text-sm font-semibold">(no note yet)</span>
            </p>
          )}
          {!rows.length && !c.ask && <p className="text-sm font-semibold">nothing written yet</p>}
        </div>
      </div>
    );
  return (
    <div className="pv-v-card relative rounded-[28px] border border-emerald-300/40 bg-[#06150f]/92 p-3 shadow-2xl shadow-black/60 sm:p-4">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-200 sm:text-xs">💭 {who} remembers</p>
      <div className="grid gap-1.5">
        {rows.map((e) => (
          <p key={e.ip} className="pv-v-in rounded-xl bg-emerald-300/10 px-3 py-2 text-[15px] text-emerald-50 sm:text-base">
            <Mono>{e.ip}</Mono> <span className="text-emerald-300">is at</span> <Mono>{e.mac}</Mono>
          </p>
        ))}
        {c.ask && !rows.some((e) => e.ip === c.ask) && (
          <p className="rounded-xl border border-dashed border-amber-300/60 px-3 py-2 text-[15px] text-amber-100 sm:text-base">
            <Mono>{c.ask}</Mono> <span className="text-amber-300">is at</span> <Mono>??</Mono> <span className="text-sm text-amber-200/80">· not known yet</span>
          </p>
        )}
        {!rows.length && !c.ask && <p className="text-sm text-slate-400">nothing yet</p>}
      </div>
    </div>
  );
}

function SwitchMemory({ c }: { c: Extract<Card, { k: "swmem" }> }) {
  const s = PLANS[c.plan].snaps[c.snap];
  const port = (p: string) => ({ fa1: 1, fa2: 2, fa3: 3, fa4: 4 })[p as "fa1"];
  return (
    <Shell title="The switch remembers" tone="cyan">
      <p className="mb-1.5 text-xs text-slate-400 sm:text-[13px]">which port each MAC lives on (it never looks at IP addresses)</p>
      <div className="grid gap-1.5">
        {Object.entries(s.swMac).map(([mac, e]) => (
          <p key={mac} className="pv-v-in rounded-xl bg-cyan-300/10 px-3 py-2 text-[15px] text-cyan-50 sm:text-base">
            {macOwner(mac)}&apos;s MAC <span className="text-cyan-300">→ port {port(e.port)}</span>
          </p>
        ))}
      </div>
    </Shell>
  );
}

const MAP: [string, string][] = [
  ["name tag (Sam)", "IP address"],
  ["desk number", "MAC address"],
  ["asking the whole room", "ARP Request (broadcast)"],
  ["Sam's raised hand", "ARP Reply (unicast)"],
  ["the sticky note", "ARP cache"],
];
function MapCard({ n }: { n: number }) {
  return (
    <Shell title="Office → network" tone="violet">
      <div className="grid gap-1.5">
        {MAP.map(([a, b], i) => (
          <div key={a} className={clsx("grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl px-2 py-1.5 transition-all duration-500", i < n ? "bg-violet-400/10 opacity-100" : "opacity-20")}>
            <span className="text-[14px] text-slate-300 sm:text-[15px]">{a}</span>
            <span className="text-violet-300">≈</span>
            <span className="text-[14px] font-semibold text-violet-50 sm:text-[15px]">{b}</span>
          </div>
        ))}
      </div>
    </Shell>
  );
}

function Mini({ label, many }: { label: string; many: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2 text-center">
      <svg viewBox="0 0 120 70" className="mx-auto h-14 w-24" aria-hidden>
        <circle cx={14} cy={35} r={9} fill={many ? "#f59e0b" : "#22d3ee"} />
        {[12, 35, 58].map((y, i) => (
          <g key={y}>
            <circle cx={104} cy={y} r={8} fill={!many && i !== 1 ? "#334155" : "#94a3b8"} />
            {(many || i === 1) && <line x1={24} y1={35} x2={95} y2={y} stroke={many ? "#f59e0b" : "#22d3ee"} strokeWidth={3} strokeDasharray={many ? "6 4" : undefined} />}
          </g>
        ))}
      </svg>
      <p className="text-[13px] font-semibold text-slate-100 sm:text-sm">{label}</p>
    </div>
  );
}

function RaceCard({ second }: { second: boolean }) {
  const first = PLANS.local.waves.findIndex((w) => w.copies[0].frame.type === "IPv4");
  const again = PLANS.again.waves.findIndex((w) => w.copies[0].frame.type === "IPv4");
  const seg = (n: number, label: string, cls: string) => (
    <span className={clsx("flex items-center justify-center rounded-md text-[11px] font-semibold sm:text-xs", cls)} style={{ flexGrow: n }}>
      {label}
    </span>
  );
  return (
    <Shell title="Before the ping can leave" tone="cyan">
      <div className="grid gap-2">
        <div>
          <p className="mb-1 text-xs text-slate-400 sm:text-[13px]">1st ping</p>
          <div className="flex h-8 gap-1">
            {seg(first / 2, "ARP request", "bg-amber-400/80 text-amber-950")}
            {seg(first / 2, "ARP reply", "bg-cyan-400/80 text-cyan-950")}
            {seg(1, "ping", "bg-violet-400/90 text-violet-950")}
          </div>
        </div>
        <div className={clsx("transition-opacity duration-500", second ? "opacity-100" : "opacity-30")}>
          <p className="mb-1 text-xs text-slate-400 sm:text-[13px]">2nd ping · the sticky note already has the answer</p>
          <div className="flex h-8 gap-1">
            {again === 0 && seg(1, "ping, at once", "bg-violet-400/90 text-violet-950")}
            <span style={{ flexGrow: first }} />
          </div>
        </div>
      </div>
    </Shell>
  );
}

function CompareCard() {
  const f = waveFrame("remote", 4);
  return (
    <Shell title="Two destinations, two jobs" tone="violet">
      <div className="grid gap-2">
        <div className="rounded-xl border border-violet-400/40 bg-violet-400/10 p-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-violet-300">IP destination · where it finally goes</p>
          <p className="text-base text-violet-50 sm:text-lg">
            Server · <Mono>{f.ip!.dst}</Mono>
          </p>
        </div>
        <div className="rounded-xl border border-cyan-400/40 bg-cyan-400/10 p-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-cyan-300">MAC destination · the next hop on this network</p>
          <p className="text-base text-cyan-50 sm:text-lg">
            Router · <Mono>{f.ethDst}</Mono>
          </p>
        </div>
      </div>
    </Shell>
  );
}

function RebuildCard({ phase }: { phase: number }) {
  const inF = waveFrame("remote", 4);
  const outF = waveFrame("remote", 8);
  return (
    <Shell title="Inside the router" tone="cyan">
      <div className="grid gap-1.5">
        <div className={clsx("rounded-xl border p-2 transition-all duration-700", phase >= 1 ? "-translate-y-1 border-rose-400/40 bg-rose-400/5 opacity-40 line-through" : "border-cyan-400/40 bg-cyan-400/10")}>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{phase >= 1 ? "old outer envelope (Ethernet) · thrown away" : "outer envelope it arrived in (Ethernet)"}</p>
          <p className="text-[14px] sm:text-[15px]">
            to <Mono>{inF.ethDst}</Mono> <span className="text-slate-400">(router)</span>
          </p>
          <p className="text-[14px] sm:text-[15px]">
            from <Mono>{inF.ethSrc}</Mono> <span className="text-slate-400">(Laptop)</span>
          </p>
        </div>
        <div className="rounded-xl border border-violet-400/40 bg-violet-400/10 p-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-violet-300">the letter inside (IP packet) · kept</p>
          <p className="text-[14px] sm:text-[15px]">
            <Mono>{inF.ip!.src}</Mono> → <Mono>{inF.ip!.dst}</Mono>
          </p>
          <p className="text-[14px] sm:text-[15px]">
            TTL{" "}
            <Mono className={clsx("transition-colors duration-500", phase >= 3 && "text-amber-200")}>
              {phase >= 3 ? `${inF.ip!.ttl} → ${outF.ip!.ttl}` : inF.ip!.ttl}
            </Mono>
          </p>
        </div>
        <div className={clsx("rounded-xl border p-2 transition-all duration-700", phase >= 2 ? "translate-y-0 border-emerald-400/50 bg-emerald-400/10 opacity-100" : "translate-y-2 border-transparent opacity-0")}>
          <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-300">new outer envelope (Ethernet)</p>
          <p className="text-[14px] sm:text-[15px]">
            to <Mono>{outF.ethDst}</Mono> <span className="text-slate-400">(Server)</span>
          </p>
          <p className="text-[14px] sm:text-[15px]">
            from <Mono>{outF.ethSrc}</Mono> <span className="text-slate-400">(router, other side)</span>
          </p>
        </div>
      </div>
    </Shell>
  );
}

const RECAP = ["Check your notes (the ARP cache)", "Nothing there? Ask the whole room: broadcast", "Only the owner answers, straight to you: unicast", "Write it down", "Then send the real traffic", "Another building? Ask for the front desk: the gateway"];
function RecapCard({ n }: { n: number }) {
  return (
    <Shell title="ARP in one breath" tone="green">
      <ol className="grid gap-1.5">
        {RECAP.map((x, i) => (
          <li key={x} className={clsx("flex items-center gap-2 rounded-xl px-2 py-1.5 text-[14px] transition-all duration-500 sm:text-[15px]", i < n || (n >= 4 && i === 4) ? "bg-emerald-400/10 text-emerald-50 opacity-100" : "opacity-25")}>
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-emerald-400/20 text-xs font-bold text-emerald-200">{i + 1}</span>
            {x}
          </li>
        ))}
      </ol>
    </Shell>
  );
}

function IdCard({ dev }: { dev: "laptop" | "pcb" }) {
  const h = HOSTS[dev];
  return (
    <Shell title={`${h.name} · two addresses`} tone="cyan">
      <div className="grid gap-1.5">
        <Field k="IP address · logical, set by the network" v={<Mono>{h.cfg.ip}</Mono>} />
        <Field k="MAC address · burned into the network card" v={<Mono>{h.mac}</Mono>} />
      </div>
    </Shell>
  );
}

export function CardView({ c }: { c: Card }) {
  switch (c.k) {
    case "frame":
      return <FrameCard c={c} />;
    case "memory":
      return <MemoryCard c={c} />;
    case "swmem":
      return <SwitchMemory c={c} />;
    case "map":
      return <MapCard n={c.n} />;
    case "bvu":
      return (
        <Shell title="Request vs reply" tone="cyan">
          <div className="grid grid-cols-2 gap-2">
            <Mini label="Request: one → everyone" many />
            <Mini label="Reply: one → one" many={false} />
          </div>
        </Shell>
      );
    case "race":
      return <RaceCard second={c.second} />;
    case "compare":
      return <CompareCard />;
    case "rebuild":
      return <RebuildCard phase={c.phase} />;
    case "recap":
      return <RecapCard n={c.n} />;
    case "id":
      return <IdCard dev={c.dev} />;
    case "note":
      return null;
  }
}
