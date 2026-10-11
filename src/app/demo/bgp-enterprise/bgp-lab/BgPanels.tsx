"use client";

import { clsx } from "clsx";
import { useState, type ReactNode } from "react";
import { ASN, BG_HOSTS, BG_LINKS, BG_ROUTERS, BG_SESSIONS, HOST_IP, LAN, LINK_TEXT, SESSIONS, advKey, bgLookup, isRouter, type BgAction, type BgDev, type BgHost, type BgNet, type BgRouter, type BgRun } from "@/lib/sim-engine/scenarios/bgpNet";
import { decisionLine } from "./bgMoments";

/**
 * Evidence panels of the BGP Lab — each reads the lab state (or one run) and nothing else:
 *   Sessions   every BGP session: type, state and, if not Established, why
 *   BestPaths  one router's paths for one prefix: every candidate, the attributes, which won and why
 *   Exits      the enterprise's way out (R1, R2 → AS65030) and the internet's way in (AS65030 → us)
 *   Announced  what each enterprise router announces to each ISP
 *   Journey    every forwarding decision (or UPDATE) of a run, hop by hop
 *   Composer   pings, traceroutes, UPDATEs, link cuts
 *   ladder     the troubleshooting questions, each answered from evidence
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
const ST: Record<string, string> = { Established: "text-pv-success", Active: "text-pv-danger", Idle: "text-pv-text-faint", "Idle (Admin)": "text-pv-warning" };
export function Sessions({ s }: { s: BgNet }) {
  return (
    <div className="space-y-0.5 text-[12px]">
      {BG_SESSIONS.map((x) => {
        const { a, b, type, link } = SESSIONS[x];
        const st = s.view.sess[x];
        return (
          <div key={x} className="flex flex-wrap items-baseline gap-x-2">
            <span className="w-[52px] font-semibold text-pv-text">{x}</span>
            <span className={clsx("pv-mono text-[11px]", type === "iBGP" ? "text-pv-violet" : "text-pv-cyan-soft")}>{type}</span>
            <span className="pv-mono text-pv-text-faint">
              AS{ASN[a]} ↔ AS{ASN[b]}
            </span>
            <span className={clsx("pv-mono font-bold", s.cfg.links[link] ? ST[st.state] : "text-pv-text-faint")}>{s.cfg.links[link] ? st.state : "link down"}</span>
            {st.why && s.cfg.links[link] && <span className="text-pv-text-muted">— {st.why}</span>}
          </div>
        );
      })}
    </div>
  );
}
const PREFIXES = [LAN.R5.prefix, LAN.R1.prefix, LAN.R2.prefix];
export function BestPaths({ s, initial = "R2", prefix: p0 = LAN.R5.prefix }: { s: BgNet; initial?: BgRouter; prefix?: string }) {
  const [r, setR] = useState<BgRouter>(initial);
  const [prefix, setPrefix] = useState(p0);
  const ps = s.view.paths[r].filter((p) => p.prefix === prefix);
  const chip = (on: boolean) => clsx("rounded-full border px-2 py-0.5 text-[11.5px] font-semibold", on ? "border-pv-cyan bg-pv-cyan/15 text-pv-text" : "border-pv-border text-pv-text-muted");
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        {BG_ROUTERS.map((x) => (
          <button key={x} type="button" onClick={() => setR(x)} className={chip(r === x)}>
            {x}
          </button>
        ))}
        <span className="mx-1 text-pv-text-faint">·</span>
        {PREFIXES.map((x) => (
          <button key={x} type="button" onClick={() => setPrefix(x)} className={chip(prefix === x)}>
            {x}
          </button>
        ))}
      </div>
      {ps.length === 0 ? (
        <p className="text-[12px] text-pv-danger">{r} has no path to {prefix}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] text-left text-[12px]">
            <thead className="text-[11px] text-pv-text-faint">
              <tr>
                <th className="px-1.5 py-1">from</th>
                <th className="px-1.5 py-1">AS_PATH</th>
                <th className="px-1.5 py-1">LOCAL_PREF</th>
                <th className="px-1.5 py-1">next hop</th>
                <th className="px-1.5 py-1">verdict</th>
              </tr>
            </thead>
            <tbody className="pv-mono">
              {ps.map((p, i) => (
                <tr key={i} className={clsx("border-t border-pv-border/50 align-top", p.best ? "text-pv-success" : !p.valid ? "text-pv-danger" : "text-pv-text-muted")}>
                  <td className="whitespace-nowrap px-1.5 py-0.5">{p.from === "local" ? "originated here" : `${p.from} (${p.type})`}</td>
                  <td className="px-1.5 py-0.5">{p.asPath.join(" ") || "—"}</td>
                  <td className="px-1.5 py-0.5">{p.localPref}</td>
                  <td className="px-1.5 py-0.5">{p.nextHop}</td>
                  <td className="px-1.5 py-0.5 font-sans">{p.best ? `BEST — ${p.reason}` : !p.valid ? `unusable — ${p.invalidWhy}` : `lost — ${p.reason}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11.5px] text-pv-text-muted">Best-path order used here: next hop reachable → highest LOCAL_PREF → shortest AS_PATH → (MED, same neighbor AS only) → eBGP over iBGP → lowest router ID.</p>
    </div>
  );
}
export function exitOf(s: BgNet, r: BgRouter): string {
  const p = s.view.paths[r].find((x) => x.prefix === LAN.R5.prefix && x.best);
  if (!p) return "no path";
  return p.from === "R3" ? "ISP-A (direct)" : p.from === "R4" ? "ISP-B (direct)" : p.from === "R1" ? "via R1 → ISP-A" : p.from === "R2" ? "via R2 → ISP-B" : String(p.from);
}
export function Exits({ s }: { s: BgNet }) {
  const entry = (lan: "R1" | "R2") => {
    const p = s.view.paths.R5.find((x) => x.prefix === LAN[lan].prefix && x.best);
    return p ? `${p.from === "R3" ? "ISP-A" : "ISP-B"} · AS_PATH ${p.asPath.join(" ")}` : "no path";
  };
  const row = (k: string, v: string, good: boolean) => (
    <div className="flex flex-wrap justify-between gap-x-3 border-b border-pv-border/50 py-0.5 text-[12px]">
      <span className="text-pv-text-muted">{k}</span>
      <span className={clsx("pv-mono", good ? "text-pv-success" : "text-pv-warning")}>{v}</span>
    </div>
  );
  return (
    <div>
      <p className="text-[11px] font-semibold text-pv-text-faint">Way out (to 203.0.113.0/24) — designed: ISP-A</p>
      {row("R1", exitOf(s, "R1"), /ISP-A/.test(exitOf(s, "R1")))}
      {row("R2", exitOf(s, "R2"), /ISP-A/.test(exitOf(s, "R2")))}
      <p className="pt-1 text-[11px] font-semibold text-pv-text-faint">Way in (AS65030&apos;s choice) — designed: ISP-A</p>
      {row(`to ${LAN.R1.prefix}`, entry("R1"), /^ISP-A/.test(entry("R1")))}
      {row(`to ${LAN.R2.prefix}`, entry("R2"), /^ISP-A/.test(entry("R2")))}
    </div>
  );
}
export function Announced({ s }: { s: BgNet }) {
  return (
    <div className="space-y-0.5 text-[12px]">
      {(
        [
          ["R1", "R3"],
          ["R2", "R4"],
          ["R1", "R2"],
          ["R2", "R1"],
        ] as [BgRouter, BgRouter][]
      ).map(([f, t]) => {
        const list = s.view.adv[advKey(f, t)] ?? [];
        const leak = SESSIONS[f === "R1" && t === "R3" ? "R1-R3" : f === "R2" && t === "R4" ? "R2-R4" : "R1-R2"].type === "eBGP" && list.some((p) => !p.prefix.startsWith("192.0.2."));
        return (
          <div key={`${f}${t}`} className="flex flex-wrap items-baseline gap-x-2">
            <span className="w-[64px] font-semibold text-pv-text">
              {f} → {t}
            </span>
            <span className={clsx("pv-mono", leak ? "text-pv-danger" : "text-pv-text-muted")}>{list.length ? list.map((p) => `${p.prefix} [${p.asPath.join(" ") || "no AS: iBGP"}]`).join(" · ") : "nothing"}</span>
            {leak && <span className="text-pv-danger">— not ours: a leak</span>}
          </div>
        );
      })}
    </div>
  );
}
export function Journey({ run, max = 40 }: { run: BgRun; max?: number }) {
  const rows: { hop: number; who: string; text: string; tone: "ok" | "warn" | "bad" | "plain" }[] = [];
  run.waves.forEach((w, i) => {
    for (const d of w.decisions) {
      const l = decisionLine(d);
      rows.push({ hop: i + 1, who: d.r, text: l.text.replace(/^R\d: /, ""), tone: l.tone === "bad" ? "bad" : "plain" });
    }
    for (const r of w.rx) rows.push({ hop: i + 1, who: r.dev, text: r.why.replace(new RegExp(`^${r.dev}: `), ""), tone: r.ok ? "ok" : r.pkt.kind === "update" ? "plain" : "bad" });
  });
  return (
    <div className="max-h-[360px] overflow-y-auto">
      <table className="w-full text-left text-[12px]">
        <tbody>
          {rows.slice(0, max).map((r, i) => (
            <tr key={i} className="border-t border-pv-border/40 align-top">
              <td className="pv-mono px-1.5 py-0.5 text-pv-text-faint">{r.hop}</td>
              <td className="whitespace-nowrap px-1.5 py-0.5 font-semibold text-pv-text">{r.who}</td>
              <td className={clsx("px-1.5 py-0.5", r.tone === "ok" ? "text-pv-success" : r.tone === "bad" ? "text-pv-danger" : "text-pv-text-muted")}>{r.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <p className="pt-1 text-[11.5px] text-pv-text-faint">… {rows.length - max} more lines.</p>}
      {run.results.some((r) => r.trace) && (
        <p className="pv-mono pt-1 text-[11.5px] text-pv-text-muted">
          traceroute: {run.results.flatMap((r) => r.trace ?? []).map((t) => `${t.hop}: ${t.ip}`).join(" · ")}
        </p>
      )}
    </div>
  );
}
export function Composer({ s, act, busy }: { s: BgNet; act: (a: BgAction) => void; busy: boolean }) {
  const [from, setFrom] = useState<BgHost>("H1");
  const [to, setTo] = useState<BgHost>("SRV");
  const dst = to === from ? BG_HOSTS.find((h) => h !== from)! : to;
  const sel = "rounded-md border border-pv-border bg-pv-bg px-1.5 py-0.5 text-[12px] text-pv-text";
  const b = "rounded-full border border-pv-border px-2.5 py-0.5 text-[12px] font-semibold text-pv-text-muted hover:border-pv-cyan/60 hover:text-pv-text disabled:opacity-40";
  return (
    <Card title="Generate traffic · run the network">
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-pv-text-muted">
        <select aria-label="From" className={sel} value={from} onChange={(e) => setFrom(e.target.value as BgHost)}>
          {BG_HOSTS.map((h) => (
            <option key={h}>{h}</option>
          ))}
        </select>
        →
        <select aria-label="To" className={sel} value={dst} onChange={(e) => setTo(e.target.value as BgHost)}>
          {BG_HOSTS.filter((h) => h !== from).map((h) => (
            <option key={h}>{h}</option>
          ))}
        </select>
        <button type="button" className={clsx(b, "border-pv-cyan/60 text-pv-text")} disabled={busy} onClick={() => act({ type: "traffic", sends: [{ from, to: HOST_IP[dst], kind: "ping" }] })}>
          Ping ▶
        </button>
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "traffic", sends: [{ from, to: HOST_IP[dst], kind: "trace" }] })}>
          Traceroute ▶
        </button>
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "updates" })}>
          Show the UPDATEs ▶
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {BG_LINKS.map((l) => (
          <button key={l} type="button" className={b} disabled={busy} onClick={() => act({ type: "link", link: l, up: !s.cfg.links[l] })}>
            {s.cfg.links[l] ? `Cut ${LINK_TEXT[l]}` : `Restore ${LINK_TEXT[l]}`}
          </button>
        ))}
      </div>
    </Card>
  );
}
export function ladder(s: BgNet, run?: BgRun): { k: string; title: string; text: string }[] {
  const r0 = run?.results[0];
  const routers = (p: BgDev[]) => p.filter(isRouter).join(" → ");
  const best = (r: BgRouter, prefix: string) => {
    const ps = s.view.paths[r].filter((p) => p.prefix === prefix);
    const b = ps.find((p) => p.best);
    return `${r}: ${ps.length} path${ps.length === 1 ? "" : "s"}${b ? `, best via ${b.from} (${b.reason})` : ", none usable"}${ps.filter((p) => !p.valid).map((p) => ` · via ${p.from} unusable: ${p.invalidWhy}`).join("")}`;
  };
  return [
    { k: "what", title: "What exactly happens — no reply, or the wrong ISP?", text: !run ? "Reproduce the problem first." : run.kind === "updates" ? `UPDATEs: R1 → ISP-A carries ${(s.view.adv[advKey("R1", "R3")] ?? []).map((p) => p.prefix).join(", ") || "nothing"}.` : r0 ? (r0.replied ? `It works — out ${routers(r0.path)}${r0.backPath ? `, back ${routers(r0.backPath)}` : ""}.` : `FAILED: ${r0.fail}`) : "—" },
    { k: "sess", title: "Are all sessions Established? (show ip bgp summary / show bgp summary)", text: BG_SESSIONS.map((x) => `${x} ${s.cfg.links[SESSIONS[x].link] ? s.view.sess[x].state : "link down"}${s.view.sess[x].why && s.view.sess[x].state !== "Established" ? ` (${s.view.sess[x].why})` : ""}`).join(" · ") },
    { k: "paths", title: "Which paths does each enterprise router have, and which is best? (show ip bgp 203.0.113.0 / show route 203.0.113.0 detail)", text: `${best("R1", LAN.R5.prefix)} · ${best("R2", LAN.R5.prefix)}` },
    { k: "attr", title: "What do the attributes say — LOCAL_PREF, AS_PATH, next hop?", text: (["R1", "R2"] as const).flatMap((r) => s.view.paths[r].filter((p) => p.prefix === LAN.R5.prefix).map((p) => `${r} via ${p.from}: LP ${p.localPref}, AS_PATH ${p.asPath.join(" ")}, NH ${p.nextHop}${p.valid ? "" : " (inaccessible)"}`)).join(" · ") },
    { k: "out", title: "What do we announce — to whom? (neighbor … advertised-routes / advertising-protocol)", text: `R1 → ISP-A: ${(s.view.adv[advKey("R1", "R3")] ?? []).map((p) => `${p.prefix} [${p.asPath.join(" ")}]`).join(", ") || "nothing"} · R2 → ISP-B: ${(s.view.adv[advKey("R2", "R4")] ?? []).map((p) => `${p.prefix} [${p.asPath.join(" ")}]`).join(", ") || "nothing"}` },
    { k: "in", title: "How does the internet come back? (an ISP looking glass: show ip bgp 192.0.2.128)", text: best("R5", LAN.R1.prefix) },
    { k: "rib", title: "What does the routing table USE? (show ip route 203.0.113.10 / show route 203.0.113.10)", text: (["R1", "R2"] as const).map((r) => { const rt = bgLookup(s.view, r, HOST_IP.SRV); return `${r}: ${rt ? `${rt.proto === "B" ? `BGP [${rt.ad}]` : "connected"} via ${rt.nh ?? "LAN"}` : "no route"}`; }).join(" · ") },
  ];
}
