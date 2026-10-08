"use client";

import { clsx } from "clsx";
import { useState, type ReactNode } from "react";
import { PacketCard } from "@/components/presentation/Visuals";
import { DNS_NAME, DNS_RECORD_TTL } from "@/lib/sim-engine/scenarios/dhcpDns";
import { DL_ADDR, DL_WRONG, configured, dlCaptureAt, dlLayersAt, type DlAction, type DlIface, type DlMsg, type DlNode, type DlPacket, type DlState } from "@/lib/sim-engine/scenarios/dhcpDnsLab";
import { dlNarrate } from "./dhcpNarrate";
import { journeyEnd, tcpdumpLine } from "./dhcpObserve";
import { PLAIN_NAME, ROLE, plainHop, plainJourney, plainMessage } from "./dhcpPlain";

/**
 * The DHCP & DNS Lab's learning path: six levels, each adding ONE skill and only the tool that skill needs.
 *   1 See the story → 2 Who does what → 3 Where could I look? → 4 Read the evidence → 5 Follow the traffic →
 *   6 Troubleshoot (the full engineer environment). The same simulation runs underneath every level.
 */

export type Level = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const LEVELS: { n: Level; short: string; title: string; skill: string }[] = [
  { n: 1, short: "See it", title: "See the story", skill: "I can see the DHCP and DNS process" },
  { n: 2, short: "Who does what", title: "Who does what", skill: "I understand what each device does" },
  { n: 3, short: "Where to look", title: "Where could I look?", skill: "I understand where I could observe it" },
  { n: 4, short: "Read evidence", title: "Read one piece of evidence", skill: "I can read a capture and know what it proves" },
  { n: 5, short: "Follow it", title: "Follow the traffic", skill: "I can follow traffic and find where it stops" },
  { n: 6, short: "Troubleshoot", title: "Troubleshoot like an engineer", skill: "I can choose the evidence I need" },
  { n: 7, short: "Build it", title: "Build it yourself", skill: "I can configure DHCP and DNS, and prove they work" },
];

export function Ladder({ level, unlocked, setLevel, onSkip }: { level: Level; unlocked: Level; setLevel: (l: Level) => void; onSkip: () => void }) {
  return (
    <nav aria-label="Learning path" className="space-y-1.5">
      <ol className="grid grid-cols-4 gap-1 sm:grid-cols-7">
        {LEVELS.map((l) => {
          const locked = l.n > unlocked;
          return (
            <li key={l.n}>
              <button type="button" disabled={locked} aria-current={l.n === level ? "step" : undefined} onClick={() => setLevel(l.n)} className={clsx("w-full rounded-lg border px-1.5 py-1 text-left", l.n === level ? "border-pv-cyan bg-pv-cyan/12 text-pv-text" : locked ? "border-pv-border/50 text-pv-text-faint opacity-60" : l.n < unlocked ? "border-pv-success/40 text-pv-text-muted hover:text-pv-text" : "border-pv-border text-pv-text-muted hover:text-pv-text")}>
                <span className="block text-[10px] font-bold">{locked ? "🔒" : l.n < unlocked ? "✓" : ""} {l.n}</span>
                <span className="block text-[11.5px] font-semibold leading-tight">{l.short}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
        <span className="text-pv-text-muted">
          Goal of this level: <b className="text-pv-text">{LEVELS[level - 1].skill}</b>
        </span>
        {unlocked < 7 && (
          <button type="button" onClick={onSkip} className="text-pv-text-faint underline-offset-2 hover:text-pv-text hover:underline">
            Already know DHCP and DNS? Unlock everything
          </button>
        )}
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Walkthrough: one card at a time, one action at a time
// ---------------------------------------------------------------------------------------------------------------
export interface LStep {
  id: string;
  title: string;
  body: ReactNode;
  /** Lab actions this step runs (each from a known state). */
  actions?: DlAction[];
  run?: string;
  focus?: string[];
  /** What to show once the step has run (or immediately, for steps without actions). */
  view?: (lab: DlState, ctx: StepCtx) => ReactNode;
}
export interface StepCtx {
  /** Open the Investigate panel (level 5+). */
  openFollow: () => void;
}

export function Walkthrough({ level, steps, idx, setIdx, ran, onRun, onFinish, finishLabel, lab, ctx, label }: { level: Level; /** Replaces "Level N" in the header (used by the engineering workspace). */ label?: string; steps: LStep[]; idx: number; setIdx: (i: number) => void; ran: boolean; onRun: () => void; onFinish: () => void; finishLabel: string; lab: DlState; ctx: StepCtx }) {
  const s = steps[idx];
  const needsRun = !!s.actions;
  const showView = !needsRun || ran;
  return (
    <section aria-label={`Level ${level}`} className="space-y-3 rounded-2xl border border-pv-cyan/40 bg-pv-cyan/[0.04] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-pv-cyan-soft">
          {label ?? `Level ${level}`} · {label ? "case" : "step"} {idx + 1} of {steps.length}
        </p>
        <div className="flex gap-1" aria-hidden>
          {steps.map((x, i) => (
            <span key={x.id} className={clsx("h-1.5 w-4 rounded-full", i === idx ? "bg-pv-cyan" : i < idx ? "bg-pv-success/60" : "bg-pv-border")} />
          ))}
        </div>
      </div>
      <h3 className="text-[18px] font-bold leading-tight text-pv-text">{s.title}</h3>
      <div className="space-y-2 text-[14px] leading-relaxed text-pv-text-muted [&_b]:text-pv-text">{s.body}</div>
      {needsRun && (
        <button type="button" onClick={onRun} className="rounded-full bg-pv-cyan px-4 py-2 text-[13.5px] font-bold text-[#03131a] hover:brightness-110">
          ▶ {ran ? "Watch it again" : s.run}
        </button>
      )}
      {showView && s.view && <div key={`${s.id}-${lab.seq}`} className="pv-pop space-y-2">{s.view(lab, ctx)}</div>}
      <div className="flex items-center justify-between gap-2 border-t border-white/10 pt-2">
        <button type="button" disabled={idx === 0} onClick={() => setIdx(idx - 1)} className="rounded-full border border-pv-border px-3 py-1 text-[12.5px] text-pv-text-muted hover:text-pv-text disabled:opacity-40">
          ← Back
        </button>
        {idx < steps.length - 1 ? (
          <button type="button" disabled={needsRun && !ran} onClick={() => setIdx(idx + 1)} className="rounded-full bg-pv-cyan/20 px-4 py-1.5 text-[13px] font-semibold text-pv-text disabled:opacity-40" title={needsRun && !ran ? "Run this step first" : undefined}>
            Next →
          </button>
        ) : (
          <button type="button" onClick={onFinish} className="rounded-full bg-pv-success/25 px-4 py-1.5 text-[13px] font-bold text-pv-text">
            {finishLabel}
          </button>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------------------------
const recent = (lab: DlState) => lab.capture.filter((p) => lab.lastPackets.includes(p.no));

/** The last action as a conversation, in everyday words. */
export function Conversation({ lab, empty }: { lab: DlState; empty?: string }) {
  const ps = recent(lab);
  if (!ps.length) return <p className="rounded-xl border border-dashed border-pv-border p-2.5 text-[13px] text-pv-text-muted">{empty ?? "Nothing was sent."}</p>;
  return (
    <ol className="space-y-1.5" aria-label="What was said">
      {ps.map((p) => {
        const m = plainMessage(p);
        return (
          <li key={p.no} className={clsx("rounded-xl border px-3 py-1.5", p.lost ? "border-pv-danger/50 bg-pv-danger/[0.05]" : "border-pv-border bg-white/[0.02]")}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-pv-text-faint">
              {m.from} → {m.to}
            </p>
            <p className="text-[14px] text-pv-text">“{m.says}”</p>
            {p.lost && <p className="text-[12px] text-pv-danger">✕ This message didn&apos;t get where it was going.</p>}
          </li>
        );
      })}
    </ol>
  );
}

export function SettingsCard({ lab }: { lab: DlState }) {
  const c = lab.client;
  const rows: [string, string | undefined, string][] = [
    ["My address", c.ip, "who I am on this network"],
    ["Router (default gateway)", c.gw, "the way out to other networks"],
    ["DNS server", c.dns, "who I ask to turn names into addresses"],
  ];
  return (
    <div className={clsx("rounded-xl border-2 p-2.5", configured(c) ? "border-pv-success/60" : c.phase === "APIPA" ? "border-pv-danger/60" : "border-pv-border")}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-pv-text-faint">The laptop&apos;s settings</p>
      {rows.map(([k, v, why]) => (
        <div key={k} className="flex flex-wrap items-baseline justify-between gap-x-2 border-b border-pv-border/50 py-1 last:border-0">
          <span className="text-[12.5px] text-pv-text">
            {k} <span className="text-[11.5px] text-pv-text-faint">· {why}</span>
          </span>
          <span className={clsx("pv-mono text-[13.5px] font-bold", v ? (c.phase === "APIPA" ? "text-pv-danger" : "text-pv-text") : "text-pv-text-faint")}>{v ?? "none yet"}</span>
        </div>
      ))}
      {c.phase === "APIPA" && <p className="mt-1 text-[12px] text-pv-danger">169.254.x.x is an address the laptop gave itself because nobody answered. It can&apos;t reach anything beyond its own network.</p>}
    </div>
  );
}

export function RoleCards() {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {(Object.keys(ROLE) as (keyof typeof ROLE)[]).map((n) => (
        <div key={n} className="rounded-xl border border-pv-border p-2.5">
          <p className="text-[13.5px] font-semibold text-pv-text">
            <span className="mr-1">{ROLE[n].icon}</span>
            {ROLE[n].title}
          </p>
          <p className="text-[12.5px] text-pv-text-muted">{ROLE[n].job}</p>
        </div>
      ))}
    </div>
  );
}

/** One message, device by device, in plain words, with the technical detail one click away. */
export function DeviceStrip({ lab, msg }: { lab: DlState; msg: DlMsg }) {
  const [open, setOpen] = useState<string | undefined>(undefined);
  const ps = recent(lab).filter((p) => p.msg === msg);
  if (!ps.length) return null;
  const m = plainMessage(ps[0]);
  return (
    <div className="rounded-xl border border-pv-border p-2.5">
      <p className="text-[12px] font-semibold text-pv-text">
        The {msg === "DISCOVER" ? "request" : msg === "OFFER" ? "answer" : msg === "DNS query" ? "name question" : msg === "DNS response" ? "name answer" : "message"}: “{m.says}”
      </p>
      <ol className="mt-1.5 space-y-1">
        {plainJourney(ps).map(({ p, h }, i) => {
          const k = `${p.no}-${i}`;
          return (
            <li key={k} className="flex gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-pv-cyan/50 text-[10px] font-bold text-pv-cyan-soft">{i + 1}</span>
              <div className="min-w-0">
                <p className={clsx("text-[13px]", ["drop", "reject", "unanswered"].includes(h.act) ? "text-pv-danger" : "text-pv-text")}>{plainHop(p, h)}</p>
                <button type="button" onClick={() => setOpen(open === k ? undefined : k)} className="text-[11px] text-pv-text-faint hover:text-pv-text">
                  {open === k ? "hide technical detail" : "technical detail"}
                </button>
                {open === k && <p className="text-[11.5px] text-pv-text-muted">{h.text}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** A checkpoint is a question about one place in the network, answered from what really crossed it. */
export interface Checkpoint {
  q: string;
  how: string;
  iface: DlIface;
  dir: "in" | "out";
  msg: DlMsg;
}
export const DHCP_CHECKS: Checkpoint[] = [
  { q: "Did the laptop send its request?", how: "a capture on the laptop's network card", iface: "CLIENT:eth0", dir: "out", msg: "DISCOVER" },
  { q: "Did the request reach the router?", how: "a capture on R1's laptop-side interface", iface: "R1:ge-0/0/0", dir: "in", msg: "DISCOVER" },
  { q: "Did the router pass it on to the servers' network?", how: "a capture on R1's server-side interface", iface: "R1:ge-0/0/1", dir: "out", msg: "DISCOVER" },
  { q: "Did it reach the DHCP server?", how: "a capture on the DHCP server", iface: "DHCP-SRV:eth0", dir: "in", msg: "DISCOVER" },
  { q: "Did an answer come back to the laptop?", how: "a capture on the laptop's network card", iface: "CLIENT:eth0", dir: "in", msg: "OFFER" },
];
export const DNS_CHECKS: Checkpoint[] = [
  { q: "Did the laptop send its name question?", how: "a capture on the laptop's network card", iface: "CLIENT:eth0", dir: "out", msg: "DNS query" },
  { q: "Did the question reach the router?", how: "a capture on R1's laptop-side interface", iface: "R1:ge-0/0/0", dir: "in", msg: "DNS query" },
  { q: "Did the router send it on towards the servers?", how: "a capture on R1's server-side interface", iface: "R1:ge-0/0/1", dir: "out", msg: "DNS query" },
  { q: "Did it reach the DNS server?", how: "a capture on the DNS server", iface: "DNS-SRV:eth0", dir: "in", msg: "DNS query" },
  { q: "Did an answer come back to the laptop?", how: "a capture on the laptop's network card", iface: "CLIENT:eth0", dir: "in", msg: "DNS response" },
];
export function CheckpointBoard({ lab, checks }: { lab: DlState; checks: Checkpoint[] }) {
  const ps = recent(lab);
  const res = checks.map((c) => ps.some((p) => p.msg === c.msg && p.obs.some((o) => o.iface === c.iface && o.dir === c.dir)));
  const lastYes = res.lastIndexOf(true);
  const allYes = res.every(Boolean);
  return (
    <div className="space-y-1.5">
      <ol className="space-y-1">
        {checks.map((c, i) => (
          <li key={c.q} className={clsx("flex items-start gap-2 rounded-lg border px-2.5 py-1.5", res[i] ? "border-pv-success/40" : "border-pv-danger/40 bg-pv-danger/[0.04]", i === lastYes && !allYes && "ring-2 ring-pv-warning/60")}>
            <span className={clsx("text-[16px] font-bold leading-none", res[i] ? "text-pv-success" : "text-pv-danger")}>{res[i] ? "✓" : "✕"}</span>
            <div>
              <p className="text-[13.5px] text-pv-text">{c.q}</p>
              <p className="text-[11.5px] text-pv-text-faint">How an engineer checks: {c.how}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className={clsx("text-[13px]", allYes ? "text-pv-success" : "text-pv-warning")}>{allYes ? "Every checkpoint saw it: the message made the whole trip, and the answer came back." : lastYes < 0 ? "Not even the first checkpoint saw it." : `The last ✓ is “${checks[lastYes].q.replace("?", "")}”. That is where to start digging.`}</p>
    </div>
  );
}

/** One real packet, as captured at one place, with each field explained. */
export interface FieldRow {
  layer: string;
  k: string;
  label: string;
  explain: string;
}
export function FriendlyPacket({ lab, msg, iface, dir, rows, where }: { lab: DlState; msg: DlMsg; iface: DlIface; dir: "in" | "out"; rows: FieldRow[]; where: string }) {
  const [full, setFull] = useState(false);
  const hit = dlCaptureAt(lab, iface).filter((r) => r.p.msg === msg && r.o.dir === dir && lab.lastPackets.includes(r.p.no));
  const row = hit[hit.length - 1];
  if (!row) return <p className="text-[12.5px] text-pv-text-faint">Nothing to show: run the step.</p>;
  const layers = dlLayersAt(row.p, row.o);
  const val = (r: FieldRow) => layers.find((l) => l.name.startsWith(r.layer))?.fields.find((f) => f.k === r.k)?.v ?? "—";
  return (
    <div className="space-y-1.5 rounded-xl border border-pv-violet/40 bg-pv-violet/[0.04] p-2.5">
      <p className="text-[11px] font-bold uppercase tracking-wide text-pv-violet">Captured {where}</p>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.label} className="grid gap-x-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
            <span className="text-[12.5px] text-pv-text">
              {r.label} <b className="pv-mono">{val(r)}</b>
            </span>
            <span className="text-[12.5px] text-pv-text-muted">{r.explain}</span>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => setFull(!full)} className="text-[11.5px] font-semibold text-pv-cyan-soft hover:underline">
        {full ? "Hide the full packet" : "Show the full packet, every field"}
      </button>
      {full && <PacketCard compact layers={layers.map((l) => ({ name: l.name, color: l.color, fields: l.fields.map((f) => ({ k: f.k, v: f.v, hi: f.hi ? ("key" as const) : undefined })) }))} />}
    </div>
  );
}

/** A real capture list at one interface, with the DHCP/DNS filters explained. */
export function FilterDemo({ lab, iface }: { lab: DlState; iface: DlIface }) {
  const [f, setF] = useState<"all" | "dhcp" | "dns">("all");
  const rows = dlCaptureAt(lab, iface).filter((r) => f === "all" || (f === "dhcp" ? r.p.proto === "DHCP" : r.p.proto === "DNS"));
  const opts: { id: typeof f; label: string; bpf: string; why: string }[] = [
    { id: "all", label: "everything", bpf: "", why: "Every frame that crossed this cable: DHCP, ARP, DNS, all mixed." },
    { id: "dhcp", label: "only DHCP", bpf: "udp port 67 or udp port 68", why: "DHCP always uses UDP ports 67 (server) and 68 (client), so this filter keeps exactly the DHCP messages. Seeing them here means DHCP traffic crossed this point; none means it never got here." },
    { id: "dns", label: "only DNS", bpf: "udp port 53", why: "DNS servers listen on UDP port 53: this keeps the questions and answers." },
  ];
  const cur = opts.find((o) => o.id === f)!;
  return (
    <div className="space-y-1.5 rounded-xl border border-pv-border bg-[#05080d] p-2.5">
      <div className="flex flex-wrap gap-1">
        {opts.map((o) => (
          <button key={o.id} type="button" onClick={() => setF(o.id)} className={clsx("rounded-full border px-2.5 py-0.5 text-[12px] font-semibold", f === o.id ? "border-pv-cyan text-pv-cyan-soft" : "border-pv-border text-pv-text-faint hover:text-pv-text")}>
            {o.label}
          </button>
        ))}
      </div>
      <p className="pv-mono text-[11px] text-pv-text-faint">R1&gt; capture on ge-0/0/0{cur.bpf ? ` filter "${cur.bpf}"` : ""}</p>
      <p className="text-[12.5px] text-pv-text-muted">{cur.why}</p>
      <ol className="max-h-48 space-y-0.5 overflow-y-auto">
        {rows.map(({ p, o }) => (
          <li key={`${p.no}-${o.dir}`} className="overflow-hidden text-ellipsis whitespace-nowrap pv-mono text-[10.5px] text-pv-text" title={tcpdumpLine(p, o)}>
            {tcpdumpLine(p, o)}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** "Where did it stop?": the learner points at the last device, then sees what the evidence says. */
export function StopPicker({ lab, msg, ctx }: { lab: DlState; msg: DlMsg; ctx: StepCtx }) {
  const [pick, setPick] = useState<DlNode | undefined>(undefined);
  const ps = recent(lab).filter((p) => p.msg === msg);
  const journey = ps.length ? ps.filter((p) => p.journey === ps[ps.length - 1].journey) : [];
  const end = journey.length ? journeyEnd(journey)!.node : "CLIENT";
  const n = dlNarrate(lab);
  const choices: DlNode[] = ["CLIENT", "SW1", "R1", "SW2", "DHCP-SRV", "DNS-SRV"];
  return (
    <div className="space-y-2 rounded-xl border border-pv-violet/40 bg-pv-violet/[0.05] p-2.5">
      <p className="text-[13px] text-pv-text">
        Open the <b>Follow</b> tool{" "}
        <button type="button" onClick={ctx.openFollow} className="font-semibold text-pv-cyan-soft hover:underline">
          (open it)
        </button>{" "}
        and find the last device the {msg === "DISCOVER" ? "DHCP request" : "name question"} reached. Which one is it?
      </p>
      <div className="flex flex-wrap gap-1.5">
        {choices.map((c) => (
          <button key={c} type="button" onClick={() => setPick(c)} className={clsx("rounded-full border px-2.5 py-0.5 text-[12px] font-semibold", pick === c ? (c === end ? "border-pv-success bg-pv-success/15 text-pv-text" : "border-pv-danger bg-pv-danger/10 text-pv-text") : "border-pv-border text-pv-text-muted hover:text-pv-text")}>
            {c}
          </button>
        ))}
      </div>
      {pick && (
        <div className="pv-pop space-y-1">
          <p className={clsx("text-[13px] font-semibold", pick === end ? "text-pv-success" : "text-pv-warning")}>{pick === end ? `✓ Yes: the evidence stops at ${end}.` : `Not quite: the evidence shows it ${end === "CLIENT" ? "never left the laptop" : `reached ${end}`}. Look again in Follow a message.`}</p>
          {pick === end && <p className="text-[13px] text-pv-text-muted">{n.why}</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The levels' content
// ---------------------------------------------------------------------------------------------------------------
const fresh: DlAction = { type: "healthy" };
const next: DlAction = { type: "dhcp-next" };
const all: DlAction = { type: "dhcp-all" };
const resolve: DlAction = { type: "resolve", name: DNS_NAME };
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const Story = ({ done }: { done: number }) => (
  <ol className="space-y-1">
    {["My computer needs network settings.", "It asks for them.", "The request has to reach the DHCP server.", "The server answers.", "The client receives an IP address, a router (gateway) and a DNS server.", "Then it can use DNS to turn a name into an IP address."].map((t, i) => (
      <li key={t} className={clsx("text-[14px]", i < done ? "text-pv-text" : "text-pv-text-faint")}>
        {i < done ? "✓" : "○"} {t}
      </li>
    ))}
  </ol>
);

export const LEVEL_STEPS: Record<Exclude<Level, 6 | 7>, LStep[]> = {
  1: [
    { id: "l1-start", title: "Your laptop has just been plugged in", body: <><p>It is connected to the network, but it can&apos;t use it yet: it has <b>no address</b>, doesn&apos;t know the <b>way out</b> of its network, and doesn&apos;t know <b>who to ask for names</b>. DHCP is how it gets those settings. Let&apos;s watch.</p><p className="text-[13px]">Tip: tap any device on the topology to meet it and see what it knows.</p></>, view: (lab) => <SettingsCard lab={lab} />, focus: ["CLIENT"] },
    { id: "l1-ask", title: "It asks: is there a DHCP server?", body: <p>The laptop doesn&apos;t know anyone&apos;s address yet, so it calls out to <b>everyone</b> on its network. The DHCP server is on another network, behind the router; the router passes the question on, and the server makes an offer.</p>, actions: [fresh, next], run: "Send the question", focus: ["CLIENT", "R1", "DHCP-SRV"], view: (lab) => <Conversation lab={lab} /> },
    { id: "l1-accept", title: "It accepts the offer", body: <p>The laptop answers that it wants the offered address, from that server. Still nothing is set up: it has only asked.</p>, actions: [fresh, next, next], run: "Accept the offer", focus: ["CLIENT", "DHCP-SRV"], view: (lab) => <Conversation lab={lab} /> },
    { id: "l1-confirm", title: "The server confirms: the settings arrive", body: <p>The server confirms, and its message carries all three settings. Now, and only now, the laptop is set up.</p>, actions: [fresh, next, next, next], run: "Receive the confirmation", focus: ["CLIENT"], view: (lab) => (<><Conversation lab={lab} /><SettingsCard lab={lab} /></>) },
    { id: "l1-name", title: "Now it can use a name", body: <p>You type <M>{DNS_NAME}</M>. Computers send to numbers, so the laptop asks the DNS server (the one DHCP just told it about): “what is the address of this name?”. You&apos;ll also see it ask “who has 10.10.10.1?” first: to send anything through the router it needs the router&apos;s hardware address. We&apos;ll come back to that.</p>, actions: [fresh, all, resolve], run: "Look up the name", focus: ["CLIENT", "DNS-SRV"], view: (lab) => <Conversation lab={lab} /> },
    { id: "l1-again", title: "Ask again: nothing is sent", body: <p>The laptop remembers answers for a while ({DNS_RECORD_TTL} seconds here). Asking again within that time sends nothing at all.</p>, actions: [fresh, all, resolve, resolve], run: "Look up the same name again", focus: ["CLIENT"], view: (lab) => <Conversation lab={lab} empty="Nothing was sent: the laptop answered from its memory (its DNS cache)." /> },
    { id: "l1-story", title: "That's the whole story", body: <p>Everything else in this lab is detail about this story: who carries each message, where you could see it, and what happens when one step fails.</p>, view: () => <Story done={6} /> },
  ],
  2: [
    { id: "l2-meet", title: "Meet the devices", body: <p>Six devices take part. Each has one simple job.</p>, view: () => <RoleCards /> },
    { id: "l2-request", title: "The request, device by device", body: <p>Send the laptop&apos;s question again, and read what each device did with it. Every line comes from what the simulation actually did. Tap a device on the topology to see the same thing from its point of view: what it just did, and what it now knows (the switches remember where the laptop is plugged in).</p>, actions: [fresh, next], run: "Send the request", focus: ["CLIENT", "SW1", "R1", "SW2", "DHCP-SRV"], view: (lab) => <DeviceStrip lab={lab} msg="DISCOVER" /> },
    { id: "l2-why", title: "Why does the router have to relay?", body: (<><p>The laptop&apos;s question is a <b>broadcast</b>: addressed to “everyone on this network”. A router connects networks and deliberately <b>doesn&apos;t</b> pass broadcasts from one to the other (otherwise every “hello everyone” would flood every network).</p><p>So R1 is set up as a <b>DHCP relay</b>: it recognizes the DHCP question, and sends a copy <b>directly</b> to the DHCP server, adding a note with its own address on the laptop&apos;s network (<M>{DL_ADDR.RC}</M>). From that note the server knows which network the laptop is on, and which addresses to offer.</p></>), focus: ["R1"] },
    { id: "l2-answer", title: "The answer comes back", body: <p>The server answers the router (the address in the note), and the router passes the answer back onto the laptop&apos;s network.</p>, actions: [fresh, next], run: "Send the request, watch the answer", focus: ["DHCP-SRV", "R1", "CLIENT"], view: (lab) => <DeviceStrip lab={lab} msg="OFFER" /> },
    { id: "l2-dns", title: "A name question needs no relay", body: <p>Once the laptop has an address, it can send normal, direct messages. The question to the DNS server is one of them: the router simply forwards it, like any message.</p>, actions: [fresh, all, resolve], run: "Look up a name", focus: ["CLIENT", "R1", "DNS-SRV"], view: (lab) => (<><DeviceStrip lab={lab} msg="DNS query" /><DeviceStrip lab={lab} msg="DNS response" /></>) },
    { id: "l2-sum", title: "Who does what", body: <ul className="list-disc space-y-1 pl-5"><li><b>Switches</b> carry messages within one network, without reading them.</li><li><b>The router</b> connects the networks: it relays the DHCP broadcast, and forwards normal messages.</li><li><b>The servers</b> answer: addresses and settings (DHCP), names (DNS).</li></ul> },
  ],
  3: [
    { id: "l3-idea", title: "An engineer can't see the animation", body: (<><p>On a real network there are no moving dots. When a laptop has no address, an engineer asks simple questions, each about <b>one place</b>: did the laptop send its request? Did it reach the router? Did the router pass it on? Did it reach the server? Did an answer come back?</p><p>Each question is answered by looking at that place: a <b>checkpoint</b>. Let&apos;s answer them for a working network first.</p></>), focus: ["CLIENT", "R1", "DHCP-SRV"] },
    { id: "l3-ok", title: "Checkpoints on a working network", body: <p>Send the request, then read the checkpoints. Each ✓ means: the message was really seen there. Tap R1: its card now shows its two cables, the places you could look, and what crossed each.</p>, actions: [fresh, next], run: "Send the request", focus: ["CLIENT", "R1", "DHCP-SRV"], view: (lab) => <CheckpointBoard lab={lab} checks={DHCP_CHECKS} /> },
    { id: "l3-broken", title: "Now the relay is switched off", body: <p>Same questions, but R1&apos;s relay is turned off. The laptop will try three times and then give itself a 169.254 address. Before reading on: where do you expect the ✓s to stop?</p>, actions: [fresh, { type: "config", patch: { relay: false } }, all], run: "Turn off the relay, ask for an address", focus: ["R1"], view: (lab) => (<><CheckpointBoard lab={lab} checks={DHCP_CHECKS} /><p className="text-[13px] text-pv-text-muted">The request reached the router and went no further. Without the relay, R1 treats it like any broadcast: it keeps it inside the laptop&apos;s network. You found the problem area without knowing anything about the router&apos;s configuration.</p></>) },
    { id: "l3-dns", title: "Checkpoints for a name lookup", body: <p>The same idea works for DNS. The question goes from the laptop, through the router, to the DNS server, and the answer comes back.</p>, actions: [fresh, all, resolve], run: "Look up a name", focus: ["CLIENT", "R1", "DNS-SRV"], view: (lab) => <CheckpointBoard lab={lab} checks={DNS_CHECKS} /> },
    { id: "l3-dnsbad", title: "The laptop was given the wrong DNS server", body: <p>Now the DHCP server hands out <M>{DL_WRONG.dns}</M> as the DNS server, an address where nothing exists. The laptop gets its settings and asks its question.</p>, actions: [fresh, { type: "config", patch: { option6: DL_WRONG.dns } }, all, resolve], run: "Give out the wrong DNS server, look up a name", focus: ["R1", "DNS-SRV"], view: (lab) => (<><CheckpointBoard lab={lab} checks={DNS_CHECKS} /><p className="text-[13px] text-pv-text-muted">The question reached the router, which found nobody at {DL_WRONG.dns}, so it never reached any DNS server. The real DNS server never even heard of it.</p></>) },
    { id: "l3-sum", title: "The last ✓ is where to dig", body: <p>You don&apos;t need to know the cause to find <b>where</b> to look. Ask the checkpoint questions in order; the last place the message was seen is where the problem is. Next, you&apos;ll learn how a checkpoint is actually read: a capture.</p> },
  ],
  4: [
    { id: "l4-capture", title: "A capture: a recording of what crossed one cable", body: <p>A capture records every message that passes one point. Here is the laptop&apos;s request, captured where it arrives at the router. Each field tells you something; read the explanations.</p>, actions: [fresh, next], run: "Send the request and capture it", focus: ["R1"], view: (lab) => (
      <FriendlyPacket lab={lab} msg="DISCOVER" iface="R1:ge-0/0/0" dir="in" where="at R1, laptop side (ge-0/0/0)" rows={[
        { layer: "IPv4", k: "Source", label: "From", explain: "0.0.0.0 means “I have no address yet”: it can only be a client asking for one." },
        { layer: "IPv4", k: "Destination", label: "To", explain: "255.255.255.255 means “everyone on this network”: it doesn't know where the server is." },
        { layer: "UDP", k: "Source port", label: "From port", explain: "68 is the DHCP client port." },
        { layer: "UDP", k: "Destination port", label: "To port", explain: "67 is the DHCP server port. DHCP always uses 67 and 68: that's how you recognize DHCP in any capture." },
        { layer: "DHCP", k: "opt 53 message type", label: "Message", explain: "The DHCP step: DISCOVER (asking), OFFER, REQUEST, ACK." },
        { layer: "DHCP", k: "xid", label: "Ticket number", explain: "The transaction ID: all four messages of one exchange share it, so you can match them." },
      ]} />) },
    { id: "l4-relay", title: "The same request, on the router's other side", body: <p>Now look at the router&apos;s <b>other</b> interface, towards the servers. If the relay works, a new message leaves here. Afterwards, tap R1: its card shows what it changed, before → after. Tap SW1 to compare: a switch changes nothing.</p>, actions: [fresh, next], run: "Send the request and capture the other side", focus: ["R1", "DHCP-SRV"], view: (lab) => (
      <FriendlyPacket lab={lab} msg="DISCOVER" iface="R1:ge-0/0/1" dir="out" where="at R1, server side (ge-0/0/1)" rows={[
        { layer: "IPv4", k: "Source", label: "From", explain: "The router itself: the relay sends a NEW message in its own name." },
        { layer: "IPv4", k: "Destination", label: "To", explain: "The DHCP server, directly: no broadcast any more." },
        { layer: "DHCP", k: "giaddr", label: "The note (giaddr)", explain: "The router's address on the laptop's network. The server picks addresses from 10.10.10.0/24 because of this." },
        { layer: "DHCP", k: "xid", label: "Ticket number", explain: "The same as before: this is still the laptop's request." },
        { layer: "UDP", k: "Destination port", label: "To port", explain: "Still 67: it's DHCP. Seeing UDP 67 here proves the relay is forwarding." },
      ]} />) },
    { id: "l4-ack", title: "Where the settings come from", body: <p>The server&apos;s confirmation, captured as it arrives at the laptop. The laptop&apos;s settings are fields in this message, copied from the server&apos;s configuration.</p>, actions: [fresh, next, next, next], run: "Get the confirmation", focus: ["CLIENT"], view: (lab) => (
      <FriendlyPacket lab={lab} msg="ACK" iface="CLIENT:eth0" dir="in" where="on the laptop's network card" rows={[
        { layer: "DHCP", k: "yiaddr", label: "Your address", explain: "The address the laptop will use." },
        { layer: "DHCP", k: "opt 3 router", label: "Option 3", explain: "The router (default gateway). If this is wrong, the laptop can't leave its network." },
        { layer: "DHCP", k: "opt 6 DNS", label: "Option 6", explain: "The DNS server. If this is wrong, names fail while addresses still work." },
        { layer: "DHCP", k: "opt 51 lease", label: "Lease", explain: "How long the settings are valid. The laptop renews halfway through." },
      ]} />) },
    { id: "l4-dns", title: "A name question, captured", body: <p>DNS has its own port too. Here are the question leaving the laptop and the answer arriving.</p>, actions: [fresh, all, resolve], run: "Look up a name and capture it", focus: ["CLIENT", "DNS-SRV"], view: (lab) => (
      <>
        <FriendlyPacket lab={lab} msg="DNS query" iface="CLIENT:eth0" dir="out" where="leaving the laptop" rows={[
          { layer: "IPv4", k: "Destination", label: "To", explain: "The DNS server from option 6." },
          { layer: "UDP", k: "Destination port", label: "To port", explain: "53 is the DNS port: a capture filter on UDP 53 shows only DNS." },
          { layer: "DNS", k: "Question", label: "Question", explain: "The name, and the record wanted (A = IPv4 address)." },
          { layer: "DNS", k: "Transaction ID", label: "Ticket number", explain: "The answer must carry the same number." },
        ]} />
        <FriendlyPacket lab={lab} msg="DNS response" iface="CLIENT:eth0" dir="in" where="arriving at the laptop" rows={[
          { layer: "DNS", k: "Answer", label: "Answer", explain: "The address for the name." },
          { layer: "DNS", k: "TTL", label: "Keep for", explain: "How long the laptop may remember it (its DNS cache)." },
        ]} />
      </>) },
    { id: "l4-filter", title: "Filters: show me only what answers my question", body: <p>A real capture is busy: DHCP, ARP and DNS all mixed. A filter keeps only what you care about. Because you now know DHCP uses ports 67/68 and DNS uses 53, the filters below mean something.</p>, actions: [fresh, all, resolve], run: "Get an address, look up a name", focus: ["R1"], view: (lab) => <FilterDemo lab={lab} iface="R1:ge-0/0/0" /> },
    { id: "l4-sum", title: "What a capture proves, and what it doesn't", body: <ul className="list-disc space-y-1 pl-5"><li>Seeing the message at a point proves it <b>got there</b>.</li><li>Not seeing it (an empty, filtered capture) proves it <b>never got there</b>.</li><li>Seeing it arrive at a server does <b>not</b> prove the server answered: look for the answer too.</li></ul> },
  ],
  5: [
    { id: "l5-intro", title: "Follow a whole message yourself", body: (<><p>Welcome to the engineering workspace. Your task is always here, in this panel. Your tools are on the right (the Tools tab on phones), one at a time: <b>Follow</b> shows one message device by device, with every point it crossed; <b>Device</b> shows what one device knows, did, and captured on each cable. Tap a device on the topology to open it there.</p><p>Send the request, follow it, and say where it ended.</p></>), actions: [fresh, next], run: "Send the request", focus: ["CLIENT", "DHCP-SRV"], view: (lab, ctx) => <StopPicker lab={lab} msg="DISCOVER" ctx={ctx} /> },
    { id: "l5-relay", title: "Case: a laptop gets 169.254", body: <p>Something is wrong between the laptop and the DHCP server. Run it, follow the request, and find the last device it reached.</p>, actions: [fresh, { type: "config", patch: { relay: false } }, all], run: "Reproduce", view: (lab, ctx) => <StopPicker lab={lab} msg="DISCOVER" ctx={ctx} /> },
    { id: "l5-dhcpsvc", title: "Case: the request arrives, nothing comes back", body: <p>This time the request may get further. Follow it carefully: reaching the server is not the same as being answered.</p>, actions: [fresh, { type: "config", patch: { serverUp: false } }, next], run: "Reproduce", view: (lab, ctx) => <StopPicker lab={lab} msg="DISCOVER" ctx={ctx} /> },
    { id: "l5-dnsopt", title: "Case: names fail, addresses work", body: <p>The laptop gets its settings, but looking up a name fails. Follow the name question.</p>, actions: [fresh, { type: "config", patch: { option6: DL_WRONG.dns } }, all, resolve], run: "Reproduce", view: (lab, ctx) => <StopPicker lab={lab} msg="DNS query" ctx={ctx} /> },
    { id: "l5-dnssvc", title: "Case: the DNS server answers pings, not names", body: <p>The laptop uses the right DNS server, and pinging it works. But names still fail. Follow the name question.</p>, actions: [fresh, all, { type: "config", patch: { dnsUp: false } }, { type: "ping", dst: DL_ADDR.DNS }, resolve], run: "Reproduce", view: (lab, ctx) => <StopPicker lab={lab} msg="DNS query" ctx={ctx} /> },
    { id: "l5-stale", title: "Case: the old address keeps coming back", body: <p>The website moved to a new server a moment ago. The laptop looks the name up again, and still gets the old address. Is anything even sent?</p>, actions: [fresh, all, resolve, { type: "migrate" }, resolve], run: "Reproduce", view: (lab, ctx) => <StopPicker lab={lab} msg="DNS query" ctx={ctx} /> },
    { id: "l5-sum", title: "You can locate a failure", body: <p>Following a message tells you <b>where</b>. Next, in Troubleshoot, the tools that tell you <b>why</b> open up: each device&apos;s tables, logs and command line, with real tickets and a free sandbox.</p> },
  ],
};

/** Level 6 intro: every tool, listed by the question it answers. */
export const QUESTION_MAP: { q: string; node: DlNode; where: string; cmd: string }[] = [
  { q: "What settings did the laptop get?", node: "CLIENT", where: "CLIENT · its configuration", cmd: "ipconfig /all" },
  { q: "Is the laptop answering from memory?", node: "CLIENT", where: "CLIENT · DNS cache", cmd: "ipconfig /displaydns" },
  { q: "Did the laptop's frames reach the switch?", node: "SW1", where: "SW1 · MAC address table", cmd: "show mac address-table" },
  { q: "Is the router set up to relay DHCP?", node: "R1", where: "R1 · DHCP relay", cmd: "show ip interface gi0/0 (Helper address)" },
  { q: "Did the relay forward anything?", node: "R1", where: "R1 · relay counters", cmd: "show dhcp relay statistics (Junos)" },
  { q: "Can the router reach that address at all?", node: "R1", where: "R1 · ARP table", cmd: "show ip arp" },
  { q: "Is the DHCP service running?", node: "DHCP-SRV", where: "DHCP-SRV · service", cmd: "systemctl status isc-dhcp-server · ss -ulnp" },
  { q: "Did the DHCP server hear this laptop? Why no offer?", node: "DHCP-SRV", where: "DHCP-SRV · log, leases", cmd: "journalctl -u isc-dhcp-server · dhcp-lease-list" },
  { q: "Did the DNS server get the question?", node: "DNS-SRV", where: "DNS-SRV · query log", cmd: "journalctl -u named" },
  { q: "Does the DNS service itself work?", node: "DNS-SRV", where: "DNS-SRV · service", cmd: "dig @127.0.0.1 www.packetverse.test" },
];
export function QuestionMap({ onOpen }: { onOpen: (n: DlNode) => void }) {
  return (
    <div className="rounded-2xl border border-pv-violet/40 bg-pv-violet/[0.05] p-3">
      <p className="text-[13.5px] font-semibold text-pv-text">New at this level: each device&apos;s tables, logs and command line</p>
      <p className="mb-1.5 text-[12.5px] text-pv-text-muted">You don&apos;t need all of them. Start from the question you have; each one points to one place.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[12px]">
          <thead className="text-[10.5px] uppercase tracking-wide text-pv-text-faint">
            <tr>
              <th className="py-0.5 pr-2">Your question</th>
              <th className="pr-2">Look at</th>
              <th>Or type</th>
            </tr>
          </thead>
          <tbody>
            {QUESTION_MAP.map((r) => (
              <tr key={r.q} className="border-t border-pv-border/50 align-top">
                <td className="py-1 pr-2 text-pv-text">{r.q}</td>
                <td className="pr-2">
                  <button type="button" onClick={() => onOpen(r.node)} className="text-left font-semibold text-pv-cyan-soft hover:underline">
                    {r.where}
                  </button>
                </td>
                <td className="pv-mono text-[11px] text-pv-text-muted">{r.cmd}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { PLAIN_NAME };
export type { DlPacket };
