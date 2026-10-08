"use client";

import { clsx } from "clsx";
import { useState, type ReactNode } from "react";
import type { CliVendor } from "@/lib/cli/types";
import { RN_HOSTS, RN_OUTSIDE, RN_ROUTERS, bits, isRouter, kindName, netOf, rnLookup, rnName, rnRib, routeKeyOf, validIp, type RnAction, type RnCfg, type RnDecision, type RnDev, type RnLookup, type RnRoute, type RnRouter, type RnRun, type RnState } from "@/lib/sim-engine/scenarios/routeNet";
import { ifName, rnVendorText } from "./rnCli";

/**
 * Evidence panels of the Routing Lab — each reads the lab state (or one test of it) and nothing else:
 *   RouteTable    one router's table: code, prefix, next hop / interface, installed or why not — and, for a lookup, which
 *                 routes contain the destination and which one wins
 *   LookupStrip   the decision on screen, in one line of pills (pinned under the topology)
 *   LpmExplorer   pick a router and a destination; predict the winner; then the proof (matching bits, lengths)
 *   Resolution    winning route → next hop → connected network → interface → ARP → frame
 *   Journey       every device's decision in a test, in order
 *   Outcomes      the four ways a packet stops at a router, and how each looks
 *   ladder        the troubleshooting questions, answered from evidence
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
export const code = (x: RnRoute) => (x.proto === "local" ? "L" : x.proto === "connected" ? "C" : x.len === 0 ? "S*" : "S");
export const via = (x: RnRoute, v: CliVendor) => (x.discard ? (v === "cisco" ? "Null0 (discard)" : "discard") : x.proto === "static" ? `via ${x.nh}${x.iface ? ` (${ifName(v, x.iface)})` : ""}` : `${x.proto === "local" ? "this router" : "directly connected"}, ${ifName(v, x.iface!)}`);

/** One router's routing table; with `lookup`, the comparison for that destination. */
export function RouteTable({ cfg, r, vendor, lookup, showLocal = false, compact }: { cfg: RnCfg; r: RnRouter; vendor: CliVendor; lookup?: RnLookup; showLocal?: boolean; compact?: boolean }) {
  const rows = rnRib(cfg, r).filter((x) => showLocal || x.proto !== "local");
  return (
    <div className="overflow-x-auto">
      <table className={clsx("w-full text-left text-[12px]", !compact && "min-w-[420px]")}>
        <thead className="text-[10.5px] text-pv-text-faint">
          <tr>
            <th className="px-1.5 py-1">code</th>
            <th className="px-1.5 py-1">destination</th>
            <th className="px-1.5 py-1">how</th>
            {lookup ? <th className="px-1.5 py-1">contains {lookup.dst}?</th> : <th className="px-1.5 py-1">state</th>}
          </tr>
        </thead>
        <tbody className="pv-mono">
          {rows.map((x, k) => {
            const c = lookup?.candidates.find((y) => y.route.prefix === x.prefix && y.route.len === x.len && y.route.proto === x.proto && y.route.nh === x.nh);
            const win = lookup?.winner && lookup.winner.prefix === x.prefix && lookup.winner.len === x.len && lookup.winner.proto === x.proto && lookup.winner.nh === x.nh;
            return (
              <tr key={k} className={clsx("border-t border-pv-border/50", !x.active && "opacity-60", win && "bg-pv-cyan/15")}>
                <td className="px-1.5 py-0.5 font-bold text-pv-text">{code(x)}</td>
                <td className={clsx("px-1.5 py-0.5", win ? "font-bold text-pv-cyan-soft" : "text-pv-text")}>{routeKeyOf(x)}</td>
                <td className="px-1.5 py-0.5 font-sans text-pv-text-muted">{via(x, vendor)}</td>
                {lookup ? (
                  <td className={clsx("px-1.5 py-0.5 font-sans", win ? "font-bold text-pv-cyan-soft" : c?.matches ? "text-pv-success" : "text-pv-text-faint")}>
                    {!x.active ? "not installed — never used" : c?.matches ? (win ? `✓ WINS — /${x.len} is the longest match` : `✓ matches (/${x.len}), but shorter`) : "✗ no"}
                  </td>
                ) : (
                  <td className={clsx("px-1.5 py-0.5 font-sans", x.active ? "text-pv-success" : "text-pv-warning")}>{x.active ? "installed" : `not installed: ${rnVendorText(vendor, x.why ?? "")}`}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The decision on screen, as pills (pinned under the topology). */
export function LookupStrip({ d, vendor }: { d?: RnDecision; vendor: CliVendor }) {
  if (!d?.lookup) return <p className="text-[11.5px] text-pv-text-faint">When a router holds the packet, its lookup appears here: every route that contains the destination, and the longest one winning.</p>;
  const lk = d.lookup;
  const cands = lk.candidates.filter((c) => c.route.proto !== "local");
  const matches = cands.filter((c) => c.matches);
  return (
    <div className="space-y-1">
      <p className="text-[11.5px] text-pv-text-muted">
        <b className="text-pv-text">{d.at}</b> looks up <b className="pv-mono text-pv-text">{d.pkt.dst}</b> in its own table — {matches.length} of {cands.length} routes contain it:
      </p>
      <div className="flex flex-wrap gap-1">
        {cands.map((c, k) => {
          const win = lk.winner === c.route;
          return (
            <span key={k} className={clsx("rounded-md border px-1.5 py-0.5 pv-mono text-[11px]", win ? "border-pv-cyan bg-pv-cyan/20 font-bold text-pv-text" : c.matches ? "border-pv-success/50 text-pv-success" : !c.route.active ? "border-dashed border-pv-border text-pv-text-faint line-through" : "border-pv-border text-pv-text-faint")} title={!c.route.active ? c.route.why : c.matches ? "contains the destination" : "does not contain the destination"}>
              {routeKeyOf(c.route)} {win ? "★" : c.matches ? "✓" : "✗"}
            </span>
          );
        })}
      </div>
      <p className={clsx("text-[11.5px]", d.outcome === "forward" ? "text-pv-cyan-soft" : "text-pv-danger")}>
        {lk.winner ? (
          <>
            Winner <b className="pv-mono">{routeKeyOf(lk.winner)}</b> (longest of {matches.length} match{matches.length > 1 ? "es" : ""}) → {lk.winner.discard ? "DISCARD: dropped here" : d.outcome === "arp-fail" ? `next hop ${d.nextHop} out ${ifName(vendor, d.egress!)} — ARP: no answer` : d.outcome === "ttl" ? "but TTL ran out first" : `next hop ${d.nextHop}${lk.winner.proto !== "static" ? " (the destination itself)" : ""} out ${ifName(vendor, d.egress!)} · ARP ${d.arp}`}
          </>
        ) : (
          <>No installed route contains {d.pkt.dst}: dropped{d.error ? `, ${kindName[d.error.kind]} sent to ${d.pkt.src}` : ""}.</>
        )}
      </p>
    </div>
  );
}

/** Route → next hop → connected network → interface → ARP → frame. */
export function Resolution({ cfg, d, vendor }: { cfg: RnCfg; d: RnDecision; vendor: CliVendor }) {
  const w = d.lookup?.winner;
  if (!w || !isRouter(d.at)) return null;
  const r = d.at;
  const conn = d.egress ? rnRib(cfg, r).find((x) => x.proto === "connected" && x.iface === d.egress) : undefined;
  const steps: { k: string; v: string; tone: "ok" | "bad" | "plain" }[] = [
    { k: "1 · winning route", v: `${routeKeyOf(w)} ${w.discard ? "discard" : w.proto === "static" ? `via ${w.nh}` : "connected"}`, tone: w.discard ? "bad" : "ok" },
    ...(w.discard ? [] : [
      { k: "2 · next hop", v: w.proto === "static" ? `${w.nh} (a neighbor, NOT written into the packet)` : `${d.pkt.dst} itself — it is on my network`, tone: "plain" as const },
      { k: "3 · reached through", v: conn ? `connected ${routeKeyOf(conn)} → ${ifName(vendor, conn.iface!)}` : "no connected network contains it", tone: conn ? ("ok" as const) : ("bad" as const) },
      { k: "4 · ARP for the next hop", v: d.arp === "failed" ? `who has ${d.nextHop}? … no answer` : `${d.nextHop} is-at ${d.arp === "cached" ? "(cached)" : "(just resolved)"}`, tone: d.arp === "failed" ? ("bad" as const) : ("ok" as const) },
      { k: "5 · frame", v: d.arp === "failed" ? "can't be built: dropped, Host Unreachable to the source" : `new Ethernet frame out ${ifName(vendor, d.egress!)} · TTL − 1 · IP source/destination unchanged`, tone: d.arp === "failed" ? ("bad" as const) : ("ok" as const) },
    ]),
  ];
  return (
    <div className="grid gap-1 sm:grid-cols-5">
      {steps.map((x, i) => (
        <div key={x.k} className={clsx("pv-pop rounded-lg border px-2 py-1", x.tone === "ok" ? "border-pv-success/40" : x.tone === "bad" ? "border-pv-danger/50" : "border-pv-border")} style={{ animationDelay: `${i * 110}ms` }}>
          <p className="text-[10px] font-bold uppercase tracking-wide text-pv-text-faint">{x.k}</p>
          <p className="pv-mono text-[11.5px] text-pv-text">{x.v}</p>
        </div>
      ))}
    </div>
  );
}

const DESTS = [
  { ip: "172.16.50.50", label: "SERVER-A" },
  { ip: "172.16.50.200", label: "SERVER-B" },
  { ip: "172.16.60.10", label: "SERVER-C" },
  { ip: "10.0.12.2", label: "R2's link address" },
  { ip: RN_OUTSIDE, label: "outside" },
  { ip: "10.10.10.10", label: "HOST-A" },
];
/** Pick a router and a destination; predict; then see the proof. */
export function LpmExplorer({ cfg, vendor, predict, initial }: { cfg: RnCfg; vendor: CliVendor; predict?: boolean; initial?: { r: RnRouter; dst: string } }) {
  const [r, setR] = useState<RnRouter>(initial?.r ?? "R1");
  const [dst, setDst] = useState(initial?.dst ?? "172.16.50.50");
  const [typed, setTyped] = useState("");
  const [guess, setGuess] = useState<string | undefined>(undefined);
  const lk = rnLookup(cfg, r, dst);
  const cands = lk.candidates.filter((c) => c.route.proto !== "local" && c.route.active);
  const revealed = !predict || !!guess;
  const pick = (ip: string) => (setDst(ip), setGuess(undefined));
  const db = bits(dst);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <span className="text-pv-text-faint">Router</span>
        {RN_ROUTERS.map((x) => (
          <button key={x} type="button" onClick={() => (setR(x), setGuess(undefined))} className={clsx("rounded-full border px-2 py-0.5 font-semibold", r === x ? "border-pv-cyan bg-pv-cyan/15 text-pv-text" : "border-pv-border text-pv-text-muted")}>
            {x}
          </button>
        ))}
        <span className="ml-2 text-pv-text-faint">destination</span>
        {DESTS.map((d) => (
          <button key={d.ip} type="button" onClick={() => pick(d.ip)} className={clsx("rounded-full border px-2 py-0.5 pv-mono text-[11px]", dst === d.ip ? "border-pv-cyan bg-pv-cyan/15 text-pv-text" : "border-pv-border text-pv-text-muted")} title={d.label}>
            {d.ip}
          </button>
        ))}
        <input value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && validIp(typed) && pick(typed)} placeholder="any IPv4 + Enter" className="w-[130px] rounded-md border border-pv-border bg-pv-bg px-1.5 py-0.5 pv-mono text-[11.5px] text-pv-text" aria-label="Destination" />
      </div>
      {predict && !guess && (
        <div className="space-y-1">
          <p className="text-[12.5px] text-pv-text-muted">
            {r}&apos;s installed routes are below, in the order {r} lists them. Which one will {r} use for <b className="pv-mono text-pv-text">{dst}</b>?
          </p>
          <div className="flex flex-wrap gap-1">
            {cands.map((c) => (
              <button key={routeKeyOf(c.route) + c.route.proto} type="button" onClick={() => setGuess(routeKeyOf(c.route))} className="rounded-md border border-pv-border px-2 py-0.5 pv-mono text-[12px] text-pv-text hover:border-pv-cyan/60">
                {routeKeyOf(c.route)}
              </button>
            ))}
            <button type="button" onClick={() => setGuess("none")} className="rounded-md border border-pv-border px-2 py-0.5 text-[12px] text-pv-text-muted hover:border-pv-cyan/60">
              none — dropped
            </button>
          </div>
        </div>
      )}
      {predict && guess && (
        <p className={clsx("text-[12.5px] font-semibold", guess === (lk.winner ? routeKeyOf(lk.winner) : "none") ? "text-pv-success" : "text-pv-warning")}>
          {guess === (lk.winner ? routeKeyOf(lk.winner) : "none") ? "✓ Right." : `✗ You picked ${guess}.`} {lk.winner ? `${r} uses ${routeKeyOf(lk.winner)}.` : `Nothing installed contains ${dst}: ${r} drops it.`}{" "}
          <button type="button" className="underline" onClick={() => setGuess(undefined)}>
            try again
          </button>
        </p>
      )}
      {revealed && (
        <>
          <RouteTable cfg={cfg} r={r} vendor={vendor} lookup={lk} />
          <div className="overflow-x-auto rounded-xl border border-pv-border p-2">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-pv-text-faint">The proof, bit by bit (the first /len bits must equal the route&apos;s)</p>
            <table className="pv-mono text-[11px]">
              <tbody>
                <tr>
                  <td className="pr-2 text-pv-text-faint">{dst}</td>
                  <td className="tracking-[0.06em] text-pv-text">{db.replace(/(.{8})(?!$)/g, "$1.")}</td>
                </tr>
                {cands
                  .filter((c) => c.route.len > 0)
                  .sort((a, b) => b.route.len - a.route.len)
                  .map((c, k) => {
                    const pb = bits(c.route.prefix);
                    return (
                      <tr key={k}>
                        <td className={clsx("pr-2", lk.winner === c.route ? "font-bold text-pv-cyan-soft" : c.matches ? "text-pv-success" : "text-pv-text-faint")}>{routeKeyOf(c.route)}</td>
                        <td className="tracking-[0.06em]">
                          {pb.split("").map((b, i) => (
                            <span key={i} className={i >= c.route.len ? "text-pv-text-faint/40" : b === db[i] ? (c.matches ? "text-pv-success" : "text-pv-success/70") : "font-bold text-pv-danger underline"}>
                              {b}
                              {i % 8 === 7 && i < 31 ? "." : ""}
                            </span>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            <p className="mt-1 text-[11.5px] text-pv-text-muted">Green = this bit agrees within the route&apos;s length; red = the first disagreement (so it doesn&apos;t match); gray = beyond the prefix, ignored. 0.0.0.0/0 has no bits to check: it matches everything, and loses to anything longer.</p>
          </div>
        </>
      )}
    </div>
  );
}

/** Every decision of a test, in order. */
export function Journey({ run, vendor, max = 60 }: { run: RnRun; vendor: CliVendor; max?: number }) {
  const rows = run.moments.flatMap((m, k) => m.decisions.map((d) => ({ k, d })));
  return (
    <div className="max-h-[360px] overflow-y-auto">
      <table className="w-full text-left text-[12px]">
        <tbody>
          {rows.slice(0, max).map(({ k, d }, i) => (
            <tr key={i} className="border-t border-pv-border/40">
              <td className="pv-mono px-1.5 py-0.5 text-pv-text-faint">{k + 1}</td>
              <td className="px-1.5 py-0.5 font-semibold text-pv-text">{d.at}</td>
              <td className="px-1.5 py-0.5 pv-mono text-[11px]" style={{ color: d.pkt.kind === "echo" ? "#38bdf8" : d.pkt.kind === "reply" ? "#34d399" : "#f87171" }}>
                {d.pkt.kind === "echo" ? "echo" : d.pkt.kind === "reply" ? "reply" : kindName[d.pkt.kind]} → {d.pkt.dst}
              </td>
              <td className={clsx("px-1.5 py-0.5", d.outcome === "forward" ? "text-pv-text-muted" : d.outcome === "deliver" || d.outcome === "local" ? "text-pv-success" : "text-pv-danger")}>{rnVendorText(vendor, d.text)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <p className="pt-1 text-[11.5px] text-pv-text-faint">… {rows.length - max} more steps (the same bounce).</p>}
    </div>
  );
}

/** The four ways a packet stops at a router — and what each looks like from the outside. */
export function Outcomes() {
  const rows = [
    { k: "No route", what: "Nothing installed contains the destination.", seen: "The router returns ICMP Destination Net Unreachable (ping: “Destination Net Unreachable”, traceroute: !N)." },
    { k: "Discard route", what: "A route matched — and it says: drop.", seen: "Silence. No ICMP comes back; ping just times out. The route is in the table, winning." },
    { k: "Next hop not resolved", what: "A route matched, but ARP for its next hop gets no answer.", seen: "ICMP Destination Host Unreachable (!H); show ip arp: Incomplete." },
    { k: "TTL ran out", what: "Every router forwarded it — in a circle.", seen: "ICMP Time Exceeded from a router on the loop; traceroute alternates between the same addresses." },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-left text-[12px]">
        <tbody>
          {rows.map((x) => (
            <tr key={x.k} className="border-t border-pv-border/50">
              <td className="px-1.5 py-1 font-semibold text-pv-text">{x.k}</td>
              <td className="px-1.5 py-1 text-pv-text-muted">{x.what}</td>
              <td className="px-1.5 py-1 text-pv-text-muted">{x.seen}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One test's outcome in words: forward leg, reply leg. */
export function TestVerdict({ run, cfg }: { run: RnRun; cfg: RnCfg }) {
  const p = run.probes[0];
  if (!p) return null;
  const req = p.arrived;
  return (
    <div className="grid gap-1 sm:grid-cols-2">
      <div className={clsx("rounded-lg border px-2 py-1 text-[12.5px]", req ? "border-pv-success/50 text-pv-success" : "border-pv-danger/50 text-pv-danger")}>
        → request {run.from} → {rnName(cfg, run.dst)}: {req ? "arrived ✓" : `stopped at ${p.stopAt ?? "?"} (${p.stop ?? "no answer"})`}
      </div>
      <div className={clsx("rounded-lg border px-2 py-1 text-[12.5px]", run.ok ? "border-pv-success/50 text-pv-success" : req ? "border-pv-danger/50 text-pv-danger" : "border-pv-border text-pv-text-faint")}>
        ← reply: {run.ok ? "came back ✓" : req ? `stopped at ${p.stopAt ?? "?"} (${p.stop ?? "?"}) — the way back is a separate lookup` : "never sent (no request arrived)"}
      </div>
    </div>
  );
}

/** Send a test from any host (or router) to any destination. */
export function Composer({ s, act, busy }: { s: RnState; act: (a: RnAction) => void; busy: boolean }) {
  const [from, setFrom] = useState<RnDev>("HOST-A");
  const [dst, setDst] = useState("172.16.50.50");
  const sel = "rounded-md border border-pv-border bg-pv-bg px-1.5 py-0.5 text-[12px] text-pv-text";
  const b = "rounded-full border border-pv-border px-2.5 py-0.5 text-[12px] font-semibold text-pv-text-muted hover:border-pv-cyan/60 hover:text-pv-text disabled:opacity-40";
  const targets = [...RN_HOSTS.map((h) => s.cfg.h[h].ip), "10.0.12.2", "10.0.13.2", RN_OUTSIDE];
  return (
    <Card title="Send traffic">
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-pv-text-muted">
        <select aria-label="From" className={sel} value={from} onChange={(e) => setFrom(e.target.value as RnDev)}>
          {[...RN_HOSTS, ...RN_ROUTERS].map((h) => (
            <option key={h}>{h}</option>
          ))}
        </select>
        →
        <select aria-label="To" className={sel} value={dst} onChange={(e) => setDst(e.target.value)}>
          {targets.map((t) => (
            <option key={t} value={t}>
              {t} ({rnName(s.cfg, t)})
            </option>
          ))}
        </select>
        <button type="button" className={clsx(b, "border-pv-cyan/60 text-pv-text")} disabled={busy} onClick={() => act({ type: "ping", from, dst })}>
          Ping ▶
        </button>
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "traceroute", from, dst })}>
          Traceroute ▶
        </button>
      </div>
    </Card>
  );
}

/** The troubleshooting questions, answered from what the lab shows now. */
export function ladder(s: RnState, vendor: CliVendor, run?: RnRun): { k: string; title: string; text: string }[] {
  const c = s.cfg;
  const p = run?.probes[0];
  const v = (t: string) => rnVendorText(vendor, t);
  const dst = run?.dst ?? "";
  const ds = run?.moments.flatMap((m) => m.decisions) ?? [];
  const firstRouter = ds.find((d) => isRouter(d.at) && d.pkt.kind === "echo");
  const per = RN_ROUTERS.map((r) => {
    const w = rnLookup(c, r, dst).winner;
    const hid = rnRib(c, r).filter((x) => x.proto === "static" && !x.active && netOf(dst, x.len) === x.prefix);
    return `${r}: ${w ? `${routeKeyOf(w)}${w.discard ? " DISCARD" : w.nh ? ` via ${w.nh}` : " connected"}` : "no installed route"}${hid.length ? ` (configured but not installed: ${hid.map(routeKeyOf).join(", ")})` : ""}`;
  });
  const back = run ? RN_ROUTERS.map((r) => { const w = rnLookup(c, r, run.from === "HOST-A" ? c.h["HOST-A"].ip : dst).winner; return `${r}: ${w ? routeKeyOf(w) : "none"}`; }) : [];
  return [
    { k: "dest", title: "What destination is failing — and from where?", text: run ? `${run.from} → ${dst} (${rnName(c, dst)}). Test the neighbors too: does a nearer address work?` : "Run the user's test first." },
    { k: "first", title: "Which router receives the packet first?", text: firstRouter ? `${firstRouter.at} (the sender's gateway).` : "None: the packet never left the sender." },
    { k: "match", title: "What routes match on each router — and which wins?", text: v(per.join(" · ")) },
    { k: "usable", title: "Is the winning route usable?", text: v(RN_ROUTERS.flatMap((r) => rnRib(c, r).filter((x) => x.proto === "static" && !x.active).map((x) => `${r} ${routeKeyOf(x)}: ${x.why}`)).join(" · ") || "Every configured static route is installed.") },
    { k: "nh", title: "What next hop / interface — and does ARP resolve it?", text: v(ds.filter((d) => isRouter(d.at) && d.nextHop).slice(0, 4).map((d) => `${d.at}: ${d.nextHop} out ${d.egress} · ARP ${d.arp}`).join(" · ") || "No router got as far as choosing a next hop.") },
    { k: "arrive", title: "Does the request reach the destination?", text: !p ? "—" : p.arrived ? "Yes — the destination received the Echo Request." : `No — it stopped at ${p.stopAt} (${p.stop}).` },
    { k: "back", title: "And the return path?", text: !p ? "—" : !p.arrived ? "Not reached yet: the request didn't arrive." : run!.ok ? "The reply came back." : `The reply stopped at ${p.stopAt} (${p.stop}). Each router looks up ${run!.from === "HOST-A" ? c.h["HOST-A"].ip : "the sender"} on its own: ${back.join(", ")}.` },
  ];
}
export { RN_HOSTS };
