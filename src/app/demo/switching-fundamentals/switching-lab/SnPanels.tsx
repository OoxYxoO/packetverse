"use client";

import { clsx } from "clsx";
import { useState, type ReactNode } from "react";
import type { CliVendor } from "@/lib/cli/types";
import { BCAST, SN_HOSTS, SN_IP, SN_UPLINKS, isSw, isUplink, snActiveUplinks, snCirculating, snLookup, snMacName, snPortStatus, snPortUp, snShortMac, type SnAction, type SnCfg, type SnDecision, type SnHost, type SnRun, type SnSend, type SnSnap, type SnState, type SnSw } from "@/lib/sim-engine/scenarios/switchNet";
import { snPortName } from "./snCli";
import { kindWords } from "./snMoments";

/**
 * Evidence panels of the Switching Lab — each one reads the lab state (or one run of it) and nothing else:
 *   WhereIs      where each host really is vs where SW1 and SW2 each THINK it is (the multi-switch comparison)
 *   Pipeline     inside one switch: frame in → learn source → look up destination → forward / flood / filter
 *   Journey      one frame hop by hop: every switch's own decision, every host's verdict
 *   Copies       how many copies of each frame every host received (1 = normal; more = a loop)
 *   LinkLoad     frames over each SW1↔SW2 link per hop (constant in a two-link loop, doubling with three)
 *   Flaps        a MAC's entry moving between ports, in order
 *   Composer     generate traffic, let time pass, clear one table
 *   ladder       the troubleshooting questions, each answered from evidence
 */

export const Card = ({ title, children, tone = "plain", right }: { title: string; children: ReactNode; tone?: "plain" | "ok" | "warn" | "bad"; right?: ReactNode }) => (
  <div className={clsx("space-y-1.5 rounded-2xl border p-3", tone === "ok" ? "border-pv-success/50 bg-pv-success/[0.06]" : tone === "warn" ? "border-pv-warning/50 bg-pv-warning/[0.06]" : tone === "bad" ? "border-pv-danger/50 bg-pv-danger/[0.05]" : "border-pv-border bg-pv-bg-elevated/30")}>
    <div className="flex items-center justify-between gap-2">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-pv-text-faint">{title}</p>
      {right}
    </div>
    {children}
  </div>
);
const L = (h: string) => h.replace("HOST-", "");

/** Where is each host — really, and according to each switch? */
export function WhereIs({ cfg, snap, vendor, hosts }: { cfg: SnCfg; snap: SnSnap; vendor: CliVendor; hosts?: SnHost[] }) {
  const list = (hosts ?? SN_HOSTS).filter((h) => cfg.hosts[h].at || h !== "HOST-E");
  const verdict = (sw: SnSw, h: SnHost) => {
    const e = snLookup(cfg, snap.fdb, sw, cfg.hosts[h].mac);
    const at = cfg.hosts[h].at;
    if (!e) return { text: "no entry → floods", tone: "muted" as const };
    const want = !at ? undefined : at.sw === sw ? at.port : "uplink";
    const right = want === "uplink" ? isUplink(e.port) && snPortUp(cfg, sw, e.port) : e.port === want;
    return { text: `${snPortName(vendor, e.port)}${e.type === "static" ? " (static)" : ""}${isUplink(e.port) ? " · uplink" : ""}`, tone: right ? ("ok" as const) : ("bad" as const) };
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[440px] text-left text-[12px]">
        <thead className="text-[11px] text-pv-text-faint">
          <tr>
            <th className="px-1.5 py-1">host (MAC)</th>
            <th className="px-1.5 py-1">really plugged into</th>
            <th className="px-1.5 py-1">SW1 thinks</th>
            <th className="px-1.5 py-1">SW2 thinks</th>
          </tr>
        </thead>
        <tbody>
          {list.map((h) => {
            const at = cfg.hosts[h].at;
            return (
              <tr key={h} className="border-t border-pv-border/50">
                <td className="px-1.5 py-1 font-semibold text-pv-text">
                  {h} <span className="pv-mono text-[11px] font-normal text-pv-text-faint">{snShortMac(cfg.hosts[h].mac)}</span>
                </td>
                <td className="pv-mono px-1.5 py-1 text-pv-text-muted">{at ? `${at.sw} ${snPortName(vendor, at.port)}` : "unplugged"}</td>
                {(["SW1", "SW2"] as SnSw[]).map((sw) => {
                  const v = verdict(sw, h);
                  return (
                    <td key={sw} className={clsx("pv-mono px-1.5 py-1", v.tone === "ok" ? "text-pv-success" : v.tone === "bad" ? "text-pv-danger" : "text-pv-text-faint")}>
                      {v.tone === "ok" ? "✓ " : v.tone === "bad" ? "✗ " : ""}
                      {v.text}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1 text-[11.5px] text-pv-text-muted">✓ right from that switch&apos;s position (its own access port, or its uplink for a host on the other switch) · ✗ wrong: frames will go the wrong way · no entry: frames to it are flooded until it sends.</p>
    </div>
  );
}

/** Inside one switch, for one frame arriving on one port. */
export function Pipeline({ cfg, d }: { cfg: SnCfg; d: SnDecision }) {
  const src = snMacName(cfg, d.frame.src);
  const dst = d.frame.dst === BCAST ? "FF:FF:FF:FF:FF:FF" : snMacName(cfg, d.frame.dst);
  const steps: { k: string; v: ReactNode; tone: "ok" | "warn" | "bad" | "plain" }[] = [
    { k: "1 · frame arrives", v: <>on {d.port}{d.n > 1 ? ` (×${d.n})` : ""} · src {snShortMac(d.frame.src)} → dst {d.frame.dst === BCAST ? "FF:FF…" : snShortMac(d.frame.dst)}</>, tone: "plain" },
    { k: "2 · learn the SOURCE", v: d.learn === "learned" ? <>new entry: {src} → {d.port}</> : d.learn === "moved" ? <>{src} MOVED {d.movedFrom} → {d.port}</> : d.learn === "refreshed" ? <>{src} → {d.port} already known (timer reset)</> : <>{src} has a static entry — not learned</>, tone: d.learn === "learned" ? "ok" : d.learn === "moved" ? "bad" : "plain" },
    { k: "3 · look up the DESTINATION", v: d.kind === "broadcast" ? <>FF:FF:FF:FF:FF:FF = everyone</> : d.hit ? <>{dst} → {d.hit.port}{d.hit.type === "static" ? " (static)" : ""}</> : <>{dst}: not in {d.sw}&apos;s table</>, tone: d.kind === "known" ? "ok" : d.kind === "filter" || d.kind === "blackhole" ? "bad" : "warn" },
    { k: "4 · decide", v: <>{kindWords[d.kind]}{d.out.length ? ` · out ${d.out.join(", ")}` : ""}</>, tone: d.kind === "known" ? "ok" : d.kind === "filter" || d.kind === "blackhole" ? "bad" : "warn" },
  ];
  return (
    <div className="grid gap-1 sm:grid-cols-4">
      {steps.map((x, i) => (
        <div key={x.k} className={clsx("pv-pop rounded-lg border px-2 py-1", x.tone === "ok" ? "border-pv-success/40" : x.tone === "warn" ? "border-pv-warning/40" : x.tone === "bad" ? "border-pv-danger/50" : "border-pv-border")} style={{ animationDelay: `${i * 110}ms` }}>
          <p className="text-[10px] font-bold uppercase tracking-wide text-pv-text-faint">{x.k}</p>
          <p className="pv-mono text-[11.5px] text-pv-text">{x.v}</p>
        </div>
      ))}
    </div>
  );
}

/** Every switch decision and host verdict of the run, hop by hop — the frame's journey. */
export function Journey({ cfg, run, vendor, max = 40 }: { cfg: SnCfg; run: SnRun; vendor: CliVendor; max?: number }) {
  const rows: { hop: number; who: string; text: string; tone: "ok" | "warn" | "bad" | "plain" }[] = [];
  run.waves.forEach((w) => {
    for (const f of w.sent) rows.push({ hop: w.k + 1, who: f.from, text: `sends ${f.kind === "arp-req" ? "a broadcast (ARP request)" : f.kind === "arp-rep" ? "an ARP reply" : f.kind === "data-rep" ? "a ping reply" : f.wantReply ? "a ping" : "a frame"} to ${f.dst === BCAST ? "FF:FF:FF:FF:FF:FF" : snMacName(cfg, f.dst)}`, tone: "plain" });
    for (const d of w.decisions) rows.push({ hop: w.k + 1, who: d.sw, text: `in ${snPortName(vendor, d.port)}${d.n > 1 ? ` ×${d.n}` : ""} · ${d.learn === "learned" ? `learns ${L(snMacName(cfg, d.frame.src))}` : d.learn === "moved" ? `MOVES ${L(snMacName(cfg, d.frame.src))} ${snPortName(vendor, d.movedFrom!)}→${snPortName(vendor, d.port)}` : d.learn === "static" ? "static source" : `knows ${L(snMacName(cfg, d.frame.src))}`} · ${kindWords[d.kind]}${d.out.length ? ` (${d.out.map((p) => snPortName(vendor, p)).join(", ")})` : ""}`, tone: d.learn === "moved" || d.kind === "filter" || d.kind === "blackhole" ? "bad" : d.kind === "known" ? "ok" : "warn" });
    for (const r of w.rx) rows.push({ hop: w.k + 1, who: r.host, text: r.wrongHost ? "accepts it (its MAC) — but it was meant for another host" : r.accepted ? `accepts it${r.n > 1 ? ` (${r.n} copies)` : ""}` : "discards it (not its MAC)", tone: r.wrongHost ? "bad" : r.accepted ? (r.n > 1 ? "warn" : "ok") : "plain" });
  });
  return (
    <div className="max-h-[340px] overflow-y-auto">
      <table className="w-full text-left text-[12px]">
        <tbody>
          {rows.slice(0, max).map((r, i) => (
            <tr key={i} className="border-t border-pv-border/40">
              <td className="pv-mono px-1.5 py-0.5 text-pv-text-faint">{r.hop}</td>
              <td className="px-1.5 py-0.5 font-semibold text-pv-text">{r.who}</td>
              <td className={clsx("px-1.5 py-0.5", r.tone === "ok" ? "text-pv-success" : r.tone === "warn" ? "text-pv-warning" : r.tone === "bad" ? "text-pv-danger" : "text-pv-text-muted")}>{r.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <p className="pt-1 text-[11.5px] text-pv-text-faint">… {rows.length - max} more lines: the copies kept going.</p>}
    </div>
  );
}

/** Copies of each frame of the run that every host received. */
export function Copies({ cfg, run }: { cfg: SnCfg; run: SnRun }) {
  const hosts = SN_HOSTS.filter((h) => cfg.hosts[h].at);
  const frames = run.results.flatMap((r) => [r.frame, ...(r.reply ? [r.reply] : [])]);
  if (!frames.length) return <p className="text-[12.5px] text-pv-text-faint">No new frame in this run — only copies already in flight.</p>;
  const got = (h: SnHost, id: number) => run.waves.flatMap((w) => w.rx).filter((x) => x.host === h && x.frame.id === id).reduce((a, x) => a + x.n, 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-left text-[12px]">
        <thead className="text-[11px] text-pv-text-faint">
          <tr>
            <th className="px-1.5 py-1">frame</th>
            {hosts.map((h) => (
              <th key={h} className="px-1.5 py-1 text-center">
                {L(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="pv-mono">
          {frames.map((f) => (
            <tr key={f.id} className="border-t border-pv-border/50">
              <td className="px-1.5 py-0.5 font-sans text-pv-text-muted">
                {L(f.from)} → {f.dst === BCAST ? "all (broadcast)" : L(snMacName(cfg, f.dst))}
              </td>
              {hosts.map((h) => {
                const n = got(h, f.id);
                return (
                  <td key={h} className={clsx("px-1.5 py-0.5 text-center", n > 1 ? "font-bold text-pv-danger" : n === 1 ? "text-pv-text" : "text-pv-text-faint")}>
                    {h === f.from ? "·" : n}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11.5px] text-pv-text-muted">How many copies reached each host&apos;s NIC (kept or discarded). A broadcast should reach each host exactly once; a known unicast only its destination.</p>
    </div>
  );
}

/** Frames crossing each SW1↔SW2 link, hop by hop — the shape of a storm. */
export function LinkLoad({ run }: { run: SnRun }) {
  const per = run.waves.map((w) => w.hops.filter((h) => isSw(h.from) && isSw(h.to)).reduce((a, h) => a + h.n, 0));
  const max = Math.max(1, ...per);
  return (
    <div className="space-y-1">
      <div className="flex h-16 items-end gap-0.5" aria-label="Copies between the switches per hop">
        {per.map((n, i) => (
          <div key={i} className="flex flex-1 flex-col items-center justify-end gap-0.5">
            <span className="pv-mono text-[9.5px] text-pv-text-faint">{n ? (n > 999 ? `${Math.round(n / 1000)}k` : n) : ""}</span>
            <div className={clsx("w-full rounded-t", n ? "bg-pv-warning/70" : "bg-pv-border")} style={{ height: `${Math.max(3, (n / max) * 44)}px` }} />
          </div>
        ))}
      </div>
      <p className="text-[11.5px] text-pv-text-muted">Copies on the SW1↔SW2 links at each hop of this run.{run.left ? ` ${run.left.toLocaleString("en-US")} still in flight when the drawing stopped — they keep going.` : ""}</p>
    </div>
  );
}

/** A MAC's entry moving between ports (from this run, or overall). */
export function Flaps({ s, vendor, run }: { s: SnState; vendor: CliVendor; run?: SnRun }) {
  const moves = s.moves.filter((m) => !run || m.run === run.id);
  if (!moves.length) return <p className="text-[12.5px] text-pv-text-faint">No MAC moved between ports{run ? " during this run" : ""}.</p>;
  const keys = [...new Set(moves.map((m) => `${m.sw}|${m.mac}`))];
  return (
    <div className="space-y-1.5">
      {keys.map((k) => {
        const [sw, mac] = k.split("|");
        const ms = moves.filter((m) => m.sw === sw && m.mac === mac);
        const chain = [ms[0].from, ...ms.map((m) => m.to)];
        return (
          <div key={k} className="flex flex-wrap items-center gap-1 text-[12px]">
            <span className="font-semibold text-pv-text">
              {sw}: {snMacName(s.cfg, mac)}
            </span>
            {chain.slice(0, 14).map((p, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-pv-text-faint">→</span>}
                <span className={clsx("pv-mono rounded border px-1", isUplink(p) ? "border-pv-violet/50 text-pv-violet" : "border-pv-border text-pv-text")}>{snPortName(vendor, p)}</span>
              </span>
            ))}
            {chain.length > 14 && <span className="text-pv-text-faint">… ({chain.length - 1} moves)</span>}
            {ms.some((m) => m.flap) && <span className="rounded-full bg-pv-danger/15 px-1.5 text-[10.5px] font-bold text-pv-danger">flapping</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Generate traffic, let time pass, clear one table. */
export function Composer({ s, act, busy }: { s: SnState; act: (a: SnAction) => void; busy: boolean }) {
  const hosts = SN_HOSTS.filter((h) => s.cfg.hosts[h].at);
  const [from, setFrom] = useState<SnHost>("HOST-A");
  const [to, setTo] = useState<SnHost | "broadcast">("HOST-C");
  const [kind, setKind] = useState<"ping" | "frame">("ping");
  const src = hosts.includes(from) ? from : hosts[0];
  const dst = to === "broadcast" || (hosts.includes(to) && to !== src) ? to : hosts.find((h) => h !== src)!;
  const send = (): SnSend => (dst === "broadcast" ? { from: src, to: "broadcast", arpFor: hosts.find((h) => h !== src && h !== "HOST-E") } : { from: src, to: dst, reply: kind === "ping" });
  const sel = "rounded-md border border-pv-border bg-pv-bg px-1.5 py-0.5 text-[12px] text-pv-text";
  const b = "rounded-full border border-pv-border px-2.5 py-0.5 text-[12px] font-semibold text-pv-text-muted hover:border-pv-cyan/60 hover:text-pv-text disabled:opacity-40";
  const circ = snCirculating(s);
  return (
    <Card title="Generate traffic">
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-pv-text-muted">
        <select aria-label="From" className={sel} value={src} onChange={(e) => setFrom(e.target.value as SnHost)}>
          {hosts.map((h) => (
            <option key={h}>{h}</option>
          ))}
        </select>
        <select aria-label="What" className={sel} value={dst === "broadcast" ? "arp" : kind} onChange={(e) => (e.target.value === "arp" ? setTo("broadcast") : (setKind(e.target.value as "ping" | "frame"), to === "broadcast" && setTo(hosts.find((h) => h !== src)!)))}>
          <option value="ping">pings</option>
          <option value="frame">sends one frame to</option>
          <option value="arp">broadcasts (ARP) for</option>
        </select>
        {dst !== "broadcast" ? (
          <select aria-label="To" className={sel} value={dst} onChange={(e) => setTo(e.target.value as SnHost)}>
            {hosts.filter((h) => h !== src).map((h) => (
              <option key={h}>{h}</option>
            ))}
          </select>
        ) : (
          <span className="pv-mono text-[12px]">{send().arpFor ? `${SN_IP[send().arpFor!]} (${send().arpFor})` : ""}</span>
        )}
        <button type="button" className={clsx(b, "border-pv-cyan/60 text-pv-text")} disabled={busy} onClick={() => act({ type: "traffic", sends: [send()] })}>
          Send ▶
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={b} disabled={busy || !circ} onClick={() => act({ type: "run" })} title="Copies already in flight keep moving">
          Let it run{circ ? ` (${circ.toLocaleString("en-US")} in flight)` : ""}
        </button>
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "wait", seconds: 60 })}>
          Wait 60 s
        </button>
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "wait", seconds: 300 })}>
          Wait 5 min
        </button>
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "clear", sw: "SW1" })}>
          Clear SW1&apos;s table
        </button>
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "clear", sw: "SW2" })}>
          Clear SW2&apos;s table
        </button>
        <span className="pv-mono text-[11px] text-pv-text-faint">lab clock {s.clock} s</span>
      </div>
    </Card>
  );
}

/** Links between the switches, as both ends see them. */
export function Uplinks({ cfg, vendor }: { cfg: SnCfg; vendor: CliVendor }) {
  const act = snActiveUplinks(cfg);
  return (
    <div className="space-y-1 text-[12px]">
      {SN_UPLINKS.filter((p) => cfg.cables[p]).map((p) => (
        <div key={p} className="flex flex-wrap items-center gap-2">
          <span className="pv-mono font-semibold text-pv-text">{snPortName(vendor, p)}</span>
          <span className="text-pv-text-muted">
            SW1 {snPortStatus(cfg, "SW1", p)} · SW2 {snPortStatus(cfg, "SW2", p)}
          </span>
          <span className={clsx("rounded-full px-1.5 text-[10.5px] font-bold", snPortUp(cfg, "SW1", p) ? "bg-pv-success/15 text-pv-success" : "bg-pv-border text-pv-text-faint")}>{snPortUp(cfg, "SW1", p) ? "forwarding" : "no link"}</span>
        </div>
      ))}
      {act.length > 1 && <p className="font-semibold text-pv-danger">{act.length} paths between SW1 and SW2 are forwarding and nothing blocks one: a Layer-2 loop.</p>}
    </div>
  );
}

/** The troubleshooting questions, in order, each answered from what the lab shows right now. */
export function ladder(s: SnState, vendor: CliVendor, run?: SnRun): { k: string; title: string; text: string }[] {
  const c = s.cfg;
  const n = (p: string) => snPortName(vendor, p);
  const res = run?.results ?? [];
  const failed = res.filter((r) => r.send.to !== "broadcast" && (!r.delivered || (r.send.reply && !r.replyDelivered)));
  const affected = [...new Set(failed.flatMap((r) => [r.send.from, r.send.to as SnHost]))];
  const where = (h: SnHost) => (c.hosts[h].at ? `${c.hosts[h].at!.sw} ${n(c.hosts[h].at!.port)}` : "unplugged");
  const think = (sw: SnSw) =>
    SN_HOSTS.filter((h) => c.hosts[h].at || h !== "HOST-E")
      .map((h) => {
        const e = snLookup(c, s.fdb, sw, c.hosts[h].mac);
        return `${L(h)} → ${e ? `${n(e.port)}${e.type === "static" ? " (static)" : ""}` : "?"}`;
      })
      .join(", ");
  const decisions = run?.waves.flatMap((w) => w.decisions) ?? [];
  const first = (sw: SnSw) => decisions.filter((d) => d.sw === sw).slice(0, 3).map((d) => `in ${n(d.port)} → ${kindWords[d.kind]}${d.out.length ? ` (${d.out.map(n).join(", ")})` : ""}`).join("; ");
  const flaps = s.moves.filter((m) => !run || m.run === run.id);
  const circ = snCirculating(s);
  return [
    { k: "who", title: "Which hosts are affected?", text: !run ? "Reproduce the problem first." : failed.length ? `${failed.map((r) => `${r.send.from} → ${r.send.to}`).join(", ")} failed in the last test. ${res.length - failed.length} other exchange(s) worked.` : "Everything in the last test worked." },
    { k: "local", title: "Local or remote — same switch or across the uplink?", text: affected.length ? affected.map((h) => `${h} is on ${where(h)}`).join(" · ") : "Name the hosts first: where is each plugged in?" },
    { k: "expect", title: "What should each switch know?", text: "Each switch should map its own hosts to their access ports, and every host of the other switch to its uplink. Nothing else." },
    { k: "sw1", title: "What does SW1 actually know?", text: `SW1: ${think("SW1")}` },
    { k: "sw2", title: "What does SW2 actually know?", text: `SW2: ${think("SW2")}` },
    { k: "path", title: "Which port did the frame enter, and where did each switch send it?", text: run ? `SW1: ${first("SW1") || "never received it"}. SW2: ${first("SW2") || "never received it"}.` : "Run the test, then read the journey / captures." },
    { k: "flap", title: "Are MACs flapping?", text: flaps.length ? `${flaps.length} move(s): ${[...new Set(flaps.map((m) => `${m.sw} ${L(snMacName(c, m.mac))} ${n(m.from)}↔${n(m.to)}`))].slice(0, 4).join(", ")}${flaps.some((m) => m.flap) ? " — back and forth" : ""}.` : "No MAC moved between ports." },
    { k: "links", title: "Is a link looping, down, or is state stale?", text: `Uplinks forwarding: ${snActiveUplinks(c).map(n).join(", ") || "none"}. ${circ ? `${circ.toLocaleString("en-US")} copies circulating.` : "Nothing circulating."} Static entries: ${(["SW1", "SW2"] as SnSw[]).flatMap((sw) => c.sw[sw].statics.map((x) => `${sw} ${L(snMacName(c, x.mac))} → ${n(x.port)}`)).join(", ") || "none"}.` },
  ];
}
export { snActiveUplinks };
