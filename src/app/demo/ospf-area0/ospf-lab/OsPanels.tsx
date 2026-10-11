"use client";

import { clsx } from "clsx";
import { useState, type ReactNode } from "react";
import type { CliVendor } from "@/lib/cli/types";
import { HOST_IP, LINK_ENDS, LINK_TEXT, OS_HOSTS, OS_LINKS, OS_ROUTERS, RID, osLookup, routeText, type OsAction, type OsHost, type OsLink, type OsRouter, type OsRun, type OsState } from "@/lib/sim-engine/scenarios/ospfNet";
import { osIfName, osVendorText } from "./osNames";
import { decisionLine } from "./osMoments";

/**
 * Evidence panels of the OSPF Lab — each reads the lab state (or one run) and nothing else:
 *   Adjacencies  every link: neighbor state and, if not FULL, why
 *   Spf          one router's shortest-path tree: cost and first hop to every router
 *   PathTo       every router's route to one LAN (source, metric, next hop)
 *   Journey      every routing decision of a run, hop by hop
 *   Composer     pings, traceroutes, Hellos, floods, link failures, silent failures, time
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
const TONE: Record<string, string> = { FULL: "text-pv-success", EXSTART: "text-pv-warning", DOWN: "text-pv-danger", INIT: "text-pv-warning" };
export function Adjacencies({ s, vendor }: { s: OsState; vendor: CliVendor }) {
  return (
    <div className="space-y-0.5 text-[12px]">
      {OS_LINKS.map((l) => {
        const [a, ai, b, bi] = LINK_ENDS[l];
        const adj = s.view.adj[l];
        return (
          <div key={l} className="flex flex-wrap items-baseline gap-x-2">
            <span className="w-[52px] font-semibold text-pv-text">{LINK_TEXT[l]}</span>
            <span className="pv-mono text-pv-text-faint">
              {osIfName(vendor, ai)} ↔ {osIfName(vendor, bi)}
            </span>
            <span className={clsx("pv-mono font-bold", s.cfg.links[l] ? TONE[adj.state] : "text-pv-text-faint")}>{s.cfg.links[l] ? (s.silent[l] !== undefined && adj.state === "FULL" ? "FULL (silent link!)" : adj.state) : "cut"}</span>
            {adj.why && s.cfg.links[l] && <span className="text-pv-text-muted">— {osVendorText(vendor, adj.why)}</span>}
            <span className="pv-mono text-pv-text-faint">
              costs {s.cfg.r[a].ifs[ai].cost} / {s.cfg.r[b].ifs[bi].cost}
            </span>
          </div>
        );
      })}
    </div>
  );
}
export function Spf({ s, vendor }: { s: OsState; vendor: CliVendor }) {
  const [r, setR] = useState<OsRouter>("R1");
  const res = s.view.spf[r];
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {OS_ROUTERS.map((x) => (
          <button key={x} type="button" onClick={() => setR(x)} className={clsx("rounded-full border px-2 py-0.5 text-[11.5px] font-semibold", r === x ? "border-pv-cyan bg-pv-cyan/15 text-pv-text" : "border-pv-border text-pv-text-muted")}>
            {x}
          </button>
        ))}
      </div>
      <table className="w-full text-left text-[12px]">
        <tbody className="pv-mono">
          {OS_ROUTERS.filter((x) => x !== r).map((x) => {
            const e = res[x];
            return (
              <tr key={x} className="border-t border-pv-border/50">
                <td className="px-1.5 py-0.5 font-sans font-semibold text-pv-text">
                  {x} ({RID[x]})
                </td>
                <td className="px-1.5 py-0.5">{e ? `cost ${e.cost}` : "unreachable"}</td>
                <td className="px-1.5 py-0.5 text-pv-text-muted">{e ? `first hop ${e.first.map((f) => `${f.nbr} (${osIfName(vendor, f.via)})`).join(" + ")}` : "not in this router's LSDB / no path"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-[11.5px] text-pv-text-muted">{r} runs Dijkstra on its own LSDB: the cheapest total cost to each router, summing the cost of every interface the path leaves through. Two equal totals = two first hops (ECMP).</p>
    </div>
  );
}
export function PathTo({ s, vendor }: { s: OsState; vendor: CliVendor }) {
  const [h, setH] = useState<OsHost>("H4");
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1 text-[11.5px] text-pv-text-muted">
        route to
        {OS_HOSTS.map((x) => (
          <button key={x} type="button" onClick={() => setH(x)} className={clsx("rounded-full border px-2 py-0.5 font-semibold", h === x ? "border-pv-cyan bg-pv-cyan/15 text-pv-text" : "border-pv-border text-pv-text-muted")}>
            {x}&apos;s LAN
          </button>
        ))}
      </div>
      <table className="w-full text-left text-[12px]">
        <tbody className="pv-mono">
          {OS_ROUTERS.map((r) => {
            const rt = osLookup(s.view, r, HOST_IP[h]);
            return (
              <tr key={r} className={clsx("border-t border-pv-border/50", rt?.proto === "S" && "text-pv-warning", !rt && "text-pv-danger")}>
                <td className="px-1.5 py-0.5 font-sans font-semibold text-pv-text">{r}</td>
                <td className="px-1.5 py-0.5">{rt ? `${rt.proto === "O" ? "OSPF" : rt.proto === "S" ? "STATIC" : "connected"} ${routeText(rt)}` : "no route"}</td>
                <td className="px-1.5 py-0.5">{rt && rt.proto !== "C" ? `[${rt.ad}/${rt.metric}]` : ""}</td>
                <td className="px-1.5 py-0.5 text-pv-text-muted">{rt ? rt.hops.map((x) => (x.nh ? `→ ${x.nh} (${osIfName(vendor, x.via)})` : "on the LAN")).join(" + ") : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
export function Journey({ run, vendor, max = 40 }: { run: OsRun; vendor: CliVendor; max?: number }) {
  const rows: { hop: number; who: string; text: string; tone: "ok" | "warn" | "bad" | "plain" }[] = [];
  run.waves.forEach((w, i) => {
    for (const d of w.decisions) {
      const l = decisionLine(d);
      rows.push({ hop: i + 1, who: d.r, text: l.text.replace(/^R\d: /, ""), tone: l.tone === "bad" ? "bad" : "plain" });
    }
    for (const r of w.rx) rows.push({ hop: i + 1, who: r.dev, text: r.why.replace(new RegExp(`^${r.dev}( ge-0/0/\\d)?: `), ""), tone: r.ok ? "ok" : "bad" });
  });
  return (
    <div className="max-h-[360px] overflow-y-auto">
      <table className="w-full text-left text-[12px]">
        <tbody>
          {rows.slice(0, max).map((r, i) => (
            <tr key={i} className="border-t border-pv-border/40 align-top">
              <td className="pv-mono px-1.5 py-0.5 text-pv-text-faint">{r.hop}</td>
              <td className="whitespace-nowrap px-1.5 py-0.5 font-semibold text-pv-text">{r.who}</td>
              <td className={clsx("px-1.5 py-0.5", r.tone === "ok" ? "text-pv-success" : r.tone === "bad" ? "text-pv-danger" : "text-pv-text-muted")}>{osVendorText(vendor, r.text)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {run.results.some((r) => r.trace) && (
        <p className="pv-mono pt-1 text-[11.5px] text-pv-text-muted">
          traceroute: {run.results.flatMap((r) => r.trace ?? []).map((t) => `${t.hop}: ${t.ip}`).join(" · ")}
        </p>
      )}
    </div>
  );
}
export function Composer({ s, act, busy }: { s: OsState; act: (a: OsAction) => void; busy: boolean }) {
  const [from, setFrom] = useState<OsHost>("H1");
  const [to, setTo] = useState<OsHost>("H4");
  const dst = to === from ? OS_HOSTS.find((h) => h !== from)! : to;
  const sel = "rounded-md border border-pv-border bg-pv-bg px-1.5 py-0.5 text-[12px] text-pv-text";
  const b = "rounded-full border border-pv-border px-2.5 py-0.5 text-[12px] font-semibold text-pv-text-muted hover:border-pv-cyan/60 hover:text-pv-text disabled:opacity-40";
  return (
    <Card title="Generate traffic · run the network">
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-pv-text-muted">
        <select aria-label="From" className={sel} value={from} onChange={(e) => setFrom(e.target.value as OsHost)}>
          {OS_HOSTS.map((h) => (
            <option key={h}>{h}</option>
          ))}
        </select>
        →
        <select aria-label="To" className={sel} value={dst} onChange={(e) => setTo(e.target.value as OsHost)}>
          {OS_HOSTS.filter((h) => h !== from).map((h) => (
            <option key={h}>{h}</option>
          ))}
        </select>
        <button type="button" className={clsx(b, "border-pv-cyan/60 text-pv-text")} disabled={busy} onClick={() => act({ type: "traffic", sends: [{ from, to: HOST_IP[dst], kind: "ping" }] })}>
          Ping ▶
        </button>
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "traffic", sends: [{ from, to: HOST_IP[dst], kind: "trace" }] })}>
          Traceroute ▶
        </button>
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "hello" })}>
          Hellos ▶
        </button>
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "flood" })}>
          Show the last LSA flood ▶
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {OS_LINKS.map((l: OsLink) => (
          <button key={l} type="button" className={b} disabled={busy} onClick={() => act({ type: "link", link: l, up: !s.cfg.links[l] })}>
            {s.cfg.links[l] ? `Cut ${LINK_TEXT[l]}` : `Restore ${LINK_TEXT[l]}`}
          </button>
        ))}
        {OS_LINKS.filter((l) => s.cfg.links[l]).map((l) => (
          <button key={`s${l}`} type="button" className={b} disabled={busy} onClick={() => act({ type: "silent", link: l, on: s.silent[l] === undefined })}>
            {s.silent[l] === undefined ? `Silent failure ${LINK_TEXT[l]}` : `Repair ${LINK_TEXT[l]}`}
          </button>
        ))}
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "wait", seconds: 40 })}>
          Wait 40 s
        </button>
      </div>
    </Card>
  );
}
export function ladder(s: OsState, vendor: CliVendor, run?: OsRun): { k: string; title: string; text: string }[] {
  const r0 = run?.results[0];
  const n = (i: string) => osIfName(vendor, i);
  return [
    { k: "what", title: "What fails — no reply, or a longer path than designed?", text: !run ? "Reproduce the problem first." : r0 ? (r0.replied ? `It works, via ${r0.path.filter((x) => /^R/.test(x)).join(" → ")}${r0.trace ? ` (${r0.trace.length} hops)` : ""}.` : `FAILED: ${r0.fail}`) : "—" },
    { k: "nbr", title: "Are all neighbors FULL? (show ip ospf neighbor / show ospf neighbor)", text: OS_LINKS.map((l) => `${LINK_TEXT[l]} ${s.cfg.links[l] ? s.view.adj[l].state : "cut"}`).join(" · ") },
    { k: "why", title: "If not: what does each end say about the other? (area, timers, MTU, passive)", text: OS_LINKS.filter((l) => s.view.adj[l].why && s.cfg.links[l]).map((l) => `${LINK_TEXT[l]}: ${osVendorText(vendor, s.view.adj[l].why!)}`).join(" · ") || "every working link is FULL" },
    { k: "lsdb", title: "Does every router hold every LSA — and does each LSA list its LAN?", text: OS_ROUTERS.map((r) => `${r}: ${s.view.lsdb[r].length} LSAs, advertises ${s.view.lsdb[r].find((l) => l.origin === r)?.stubs.filter((x) => x.net.startsWith("192.168")).map((x) => x.net).join(", ") || "no LAN"}`).join(" · ") },
    { k: "spf", title: "What did SPF choose? (costs per interface)", text: OS_ROUTERS.map((r) => `${r}: ${OS_ROUTERS.filter((x) => x !== r).map((x) => `${x} ${s.view.spf[r][x]?.cost ?? "∞"}`).join(", ")}`).join(" · ") },
    { k: "rib", title: "What does the routing table USE for the destination? (static vs OSPF)", text: OS_ROUTERS.map((r) => { const rt = osLookup(s.view, r, HOST_IP.H4); return `${r} → 192.168.4.0/24: ${rt ? `${rt.proto === "S" ? "STATIC" : rt.proto === "O" ? "OSPF" : "connected"} via ${rt.hops.map((h) => h.nh ?? n(h.via)).join("/")}` : "none"}`; }).join(" · ") },
  ];
}
