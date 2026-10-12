"use client";

import { useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { SpLabWorkspace, type SpCtx, type SpLabSpec } from "@/components/sp-lab/SpLabWorkspace";
import { SpStage, type SpPath, type SpStageLink, type SpStageNode } from "@/components/sp-lab/SpStage";
import { SpConsole } from "@/components/sp-lab/SpDesk";
import { Card, Kv, Pill, STable, Tabs } from "@/components/sp-lab/SpUi";
import { spClone, spStamp, type SpMoment } from "@/components/sp-lab/spKit";
import type { SpDevCli } from "@/components/sp-lab/spCli";
import { spText, xrIf } from "@/components/sp-lab/spNames";
import type { TopoView } from "@/components/presentation/Visuals";
import {
  T6_CAUSES,
  T6_LINKS,
  T6_LO,
  T6_ROUTERS,
  T6_TICKETS,
  createT6Net,
  locOf,
  lossText,
  t6Apply,
  t6CauseFeedback,
  t6Frr,

  t6Ifs,
  t6Ladder,
  t6Proofs,
  t6Prot,
  type IfName,
  type T6Action,
  type T6Fail,
  type T6Hop,
  type T6R,
  type T6Rtr,
  type T6Snap,
  type T6State,
  type T6TicketId,
} from "@/lib/sim-engine/scenarios/s6tNet";
import { t6Sets, type T6CliApi } from "./t6Cli";
import { T6_LEVELS } from "./t6Learn";
import { T6_CHALLENGES } from "./t6Practice";

/**
 * SRv6 TI-LFA Lab — the guided lesson's network on IOS XR: CUST-A's SRv6 L3VPN flow CE1 ↔ CE2 over PE1–P1–P2–PE2, a
 * protection path P1–P3–P4, TI-LFA with SRv6 repair SIDs, BFD on the silent DWDM link P1–P2.
 *   LEARN                  6 levels (t6Learn)
 *   ENGINEERING WORKSPACE  Investigate (pings, failure drills on any link or router, hand-built repairs; router windows
 *                          with backups, interfaces, SIDs and an IOS XR console) · Challenges (five) · Troubleshoot (five)
 * One model (s6tNet.ts) produces every adjacency, SID, backup, repair packet and drill result.
 */

type Ctx = SpCtx<T6State, T6Action, T6Snap>;
type Node = T6R | "CE1" | "CE2";
const POS: Record<Node, { x: number; y: number; cx: number; cy: number }> = {
  CE1: { x: 4, y: 56, cx: 4, cy: 43 },
  PE1: { x: 16, y: 56, cx: 16, cy: 43 },
  P1: { x: 33, y: 56, cx: 33, cy: 43 },
  P2: { x: 60, y: 20, cx: 60, cy: 7 },
  PE2: { x: 84, y: 40, cx: 84, cy: 27 },
  CE2: { x: 97, y: 40, cx: 97, cy: 27 },
  P3: { x: 45, y: 86, cx: 45, cy: 99 },
  P4: { x: 68, y: 86, cx: 68, cy: 99 },
};
const role = (d: string) => (d.startsWith("CE") ? "CE" : d.startsWith("PE") ? "PE" : "P");
const short = (x: string) => x.replace("2001:db8:110:", "…:");
const DRILLS: { id: string; label: string; fail: T6Fail }[] = [...T6_LINKS.map((l) => ({ id: l.id, label: `cut ${l.id.replace("-", "–")}`, fail: { link: l.id } })), ...(["P2", "P3", "P4"] as T6R[]).map((r) => ({ id: r, label: `${r} fails`, fail: { node: r } }))];

const lastDrillHops = (c: Ctx): T6Hop[] | undefined => {
  const d = c.s.drills[c.s.drills.length - 1];
  const t = c.s.tests[c.s.tests.length - 1];
  const dRun = [...c.s.runs].reverse().find((r) => r.kind === "test");
  if (d && dRun?.cmd.startsWith("Drill")) return d.results.find((r) => r.affected)?.walk?.hops;
  return t?.walk.hops;
};
function stage(c: Ctx, p: { moment?: SpMoment<T6Snap>; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) {
  const v = c.live.view;
  const s = c.s;
  const nodes: SpStageNode[] = (Object.keys(POS) as Node[]).map((d) => ({ id: d, label: d, role: role(d), tone: d.startsWith("CE") ? "#34d399" : "#22d3ee", sub: d.startsWith("CE") ? (d === "CE1" ? "10.10.1.0/24" : "10.20.1.0/24") : locOf(d as T6R).replace("2001:db8:110:", "…:"), ...POS[d] }));
  const d = s.drills[s.drills.length - 1];
  const failed = d && d.cfgSeq === s.cfgSeq ? d.fail : undefined;
  const links: SpStageLink[] = [
    { id: "CE1-PE1", a: "CE1", b: "PE1", state: "up" },
    { id: "PE2-CE2", a: "PE2", b: "CE2", state: "up" },
    ...T6_LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b, state: (!v.adj[l.id] || failed?.link === l.id || failed?.node === l.a || failed?.node === l.b ? "blocked" : "up") as SpStageLink["state"], label: `${s.cfg[l.a].ifs[l.ai]!.metric}${l.silent ? " · DWDM" : ""}` })),
  ];
  const pr = t6Prot(v, "P1", "PE2");
  const views: Record<string, TopoView> = { P1: { badge: { text: pr?.backup ? `backup: ${pr.backup.repair.length ? short(pr.backup.repair[0]) : "via P3"}` : "no backup", tone: pr?.backup ? "info" : "warn" } } };
  const paths: SpPath[] = [];
  if (!p.moment) {
    const hops = lastDrillHops(c);
    if (hops?.length) {
      const nodesOnPath = [hops[0].from, ...hops.filter((h) => h.from !== h.to).map((h) => h.to)];
      paths.push({ id: "w", nodes: nodesOnPath, color: hops.some((h) => h.repair) ? "#fbbf24" : "#a78bfa", offset: 0 });
    }
  }
  return <SpStage nodes={nodes} links={links} paths={paths} views={views} moment={p.moment} momentKey={p.momentKey} compact={p.compact} onNode={p.onNode} selected={p.selected} regions={[{ x: 11, y: 4, w: 80, h: 92, label: "IS-IS IPv6 + SRv6 · TI-LFA", color: "#22d3ee" }]} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------------------------
type Cell = string | [string, "ok" | "bad" | "warn"];
function Frr({ c, only }: { c: Ctx; only?: T6R }) {
  const v = c.live.view;
  const routers: T6R[] = only ? [only] : ["P1", "P2", "PE2"];
  const rows = routers.flatMap((r) => v.prot[r].filter((p) => only || p.dst === "PE2" || p.dst === "PE1").map((p) => [r, `${p.dst} (${short(locOf(p.dst))}/64)`, `${p.nh.nh}`, p.backup ? `${p.backup.kind === "lfa" ? "LFA" : `TI-LFA ${p.backup.protect}`} via ${p.backup.nh.nh}` : ["none", "bad"], p.backup ? (p.backup.repair.length ? p.backup.repair.map(short).join(", ") : "—") : p.noBackup ?? "no fast reroute"] as Cell[]));
  return <STable cols={["Router", "Destination", "Primary", "Backup", "Repair SIDs"]} rows={rows} />;
}
function DrillView({ c }: { c: Ctx }) {
  const d = c.s.drills[c.s.drills.length - 1];
  if (!d) return <p className="text-[12px] text-pv-text-faint">Run a drill above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The results appear when the drill has finished.</p>;
  return (
    <div className="space-y-1">
      <p className="text-[12px] font-semibold text-pv-text">Drill: {d.what}</p>
      <STable cols={["Flow", "PLR", "Detection", "Recovery", "Traffic lost"]} rows={d.results.map((r) => [r.flow, r.plr ?? "—", r.detect ? `${r.detect === "light" ? "loss of light" : r.detect === "bfd" ? "BFD" : "IS-IS hold time"} (${lossText(r.detectMs!)})` : "—", r.affected ? (r.how === "local" ? [`local repair${r.backup?.repair.length ? ` [${r.backup.repair.map(short).join(", ")}]` : ""}`, "ok"] : [r.how === "converge" ? "waits for convergence" : r.how, "bad"]) : "unaffected", r.affected ? (r.how === "local" && r.lossMs < 1000 ? [lossText(r.lossMs), "ok"] : [lossText(r.lossMs), "bad"]) : "0"] as Cell[])} />
      {d.results.filter((r) => r.affected).map((r) => (
        <p key={r.flow} className="text-[11.5px] text-pv-text-muted">
          {r.flow}: {r.why}.
        </p>
      ))}
    </div>
  );
}
function Headers({ c }: { c: Ctx }) {
  const hops = lastDrillHops(c);
  if (!hops) return <p className="text-[12px] text-pv-text-faint">Ping or drill above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The headers appear when the run has finished.</p>;
  const rows = hops.filter((h) => h.from !== h.to).map((h) => [`${h.from} → ${h.to}`, h.hdrs.length ? short(h.hdrs[0].da) : "—", h.hdrs.length > 1 ? h.hdrs.slice(1).map((x) => short(x.da)).join(" › ") : "—", h.hdrs.length > 1 ? ["repair header on top", "warn"] : h.hdrs.length ? "VPN packet" : "customer IPv4"] as Cell[]);
  return <STable cols={["Link", "Outer DA", "Inside (DA)", "What it is"]} rows={rows} />;
}
function PathView({ c }: { c: Ctx }) {
  const run = [...c.s.runs].reverse().find((r) => r.kind === "test");
  if (!run) return <p className="text-[12px] text-pv-text-faint">Ping or drill above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The walk appears when the run has finished.</p>;
  return (
    <ol className="space-y-0.5">
      {run.moments.map((m, i) => (
        <li key={i} className={clsx("text-[12px]", m.lines[0]?.tone === "warn" || m.lines[0]?.tone === "bad" ? "text-pv-warning" : m.lines[0]?.tone === "ok" ? "text-pv-success" : "text-pv-text-muted")}>
          {spText(c.vendor, m.lines[0]?.text ?? "")}
        </li>
      ))}
    </ol>
  );
}
function TestView({ c }: { c: Ctx }) {
  const t = c.s.tests[c.s.tests.length - 1];
  if (!t) return <p className="text-[12px] text-pv-text-faint">Ping above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The result appears when the run has finished.</p>;
  return (
    <div className={clsx("rounded-lg border px-2 py-1 text-[12.5px]", t.walk.ok ? "border-pv-success/40" : "border-pv-danger/40")}>
      <p className="font-semibold text-pv-text">
        {t.flow}: <span className={t.walk.ok ? "text-pv-success" : "text-pv-danger"}>{t.walk.ok ? "delivered" : "failed"}</span>
      </p>
      <p className="text-[11.5px] text-pv-text-muted">path {t.walk.path.join(" → ")}</p>
      {t.walk.why && <p className="text-[11.5px] text-pv-warning">{t.walk.why}</p>}
    </div>
  );
}
function Sids({ c, only }: { c: Ctx; only?: T6R }) {
  const v = c.live.view;
  const rows = T6_ROUTERS.filter((r) => !only || r === only).flatMap((r) => (v.sids[r].length ? v.sids[r].map((x) => [r, x.sid, x.behavior === "End.DT4" ? "End.DT4" : `${x.behavior} (USD)`, x.peer ? `→ ${x.peer}` : x.behavior === "End.DT4" ? "VRF CUST-A" : "this node"] as Cell[]) : [[r, ["none — no locator in IS-IS", "bad"], "—", "—"] as Cell[]]));
  return <STable cols={["Router", "Local SID", "Behavior", "Context"]} rows={rows} />;
}
function Ladder({ c }: { c: Ctx }) {
  if (c.busy) return <p className="text-[12px] text-pv-text-faint">The ladder fills in when the run has finished.</p>;
  return (
    <ol className="space-y-1">
      {t6Ladder(c.s).map((r, i) => (
        <li key={r.k} className="rounded-lg border border-pv-border/70 px-2 py-1 text-[12px]">
          <b className="text-pv-text">
            {i + 1}. {r.title}
          </b>{" "}
          <span className="text-pv-text-muted">{r.text}</span>
        </li>
      ))}
    </ol>
  );
}
function evidence(key: string, c: Ctx): ReactNode {
  const card = (t: string, body: ReactNode) => <Card title={t}>{body}</Card>;
  switch (key) {
    case "frr":
      return card("Precomputed backups (toward PE2 and PE1)", <Frr c={c} />);
    case "drill":
      return card("The drill, flow by flow", <DrillView c={c} />);
    case "headers":
      return card("The packet, link by link", <Headers c={c} />);
    case "path":
      return card("What each router did", <PathView c={c} />);
    case "test":
      return card("What the ping did", <TestView c={c} />);
    case "sids":
      return card("Local SID tables", <Sids c={c} />);
    case "ladder":
      return card("The evidence ladder, read from the network", <Ladder c={c} />);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Router windows
// ---------------------------------------------------------------------------------------------------------------
function cfgDiff(a: T6Rtr, b: T6Rtr): string {
  const out: string[] = [];
  if (a.isisLoc !== b.isisLoc) out.push(`SRv6 locator ${b.isisLoc ? "advertised" : "withdrawn"} in IS-IS`);
  for (const k of Object.keys(b.ifs) as IfName[]) {
    const x = a.ifs[k]!;
    const y = b.ifs[k]!;
    for (const f of ["isis", "frr", "tilfa", "node", "bfd"] as const) if (x[f] !== y[f]) out.push(`${xrIf(k, true)} ${f === "tilfa" ? "TI-LFA" : f === "node" ? "node-protecting" : f === "frr" ? "fast-reroute" : f.toUpperCase()} ${y[f] ? "on" : "off"}`);
    if (x.metric !== y.metric) out.push(`${xrIf(k, true)} metric ${y.metric}`);
  }
  return out.join(", ") || "no change";
}
function devCli(c: Ctx, r: T6R): SpDevCli<T6Rtr> {
  return {
    host: r,
    running: c.s.cfg[r],
    hist: c.s.hist[r],
    cand: c.cli.cand[r] as T6Rtr | undefined,
    setCand: (x) => c.cli.setCand(r, x),
    xr: c.cli.xr[r] ?? [],
    setXr: (st) => c.cli.setXr(r, st),
    edit: !!c.cli.edit[r],
    setEdit: (b) => c.cli.setEdit(r, b),
    commit: (cfg, how) => c.act({ type: "cfg", dev: r, cfg, text: `${cfgDiff(c.s.cfg[r], cfg)} (${how}, IOS XR)` }),
    ask: c.cli.setQuestion,
  };
}
type Tab = "frr" | "ifs" | "sids" | "term" | "log";
function RouterUI({ c, r }: { c: Ctx; r: T6R }) {
  const [tab, setTab] = useState<Tab>("frr");
  const s = c.s;
  const cfg = s.cfg[r];
  const v = c.live.view;
  const change = (f: (x: T6Rtr) => void) => {
    const n = spClone(cfg);
    f(n);
    c.act({ type: "cfg", dev: r, cfg: n, text: `${cfgDiff(cfg, n)} (from ${r}'s window)` });
  };
  const api: T6CliApi = { s, act: c.act, dev: devCli(c, r) };
  const box = (on: boolean, label: string, f: (x: T6Rtr) => void) => <input type="checkbox" aria-label={label} checked={on} disabled={c.busy} onChange={() => change(f)} />;
  return (
    <div>
      <Tabs tabs={[["frr", "Backups"], ["ifs", "Interfaces"], ["sids", "SIDs"], ["term", "Console"], ["log", "Log"]]} cur={tab} set={setTab} />
      <div className="space-y-2 p-3">
        {tab === "frr" && (
          <>
            <Card title={`${r} · ${T6_LO(r)} · locator ${locOf(r)}/64`}>
              <div className="grid gap-x-4 sm:grid-cols-2">
                <Kv k="SRv6 locator in IS-IS" v={cfg.isisLoc ? "MAIN" : "no"} tone={cfg.isisLoc ? undefined : "warn"} />
                <Kv k="Destinations with a backup" v={`${v.prot[r].filter((p) => p.backup).length} of ${v.prot[r].length}`} />
              </div>
            </Card>
            <Frr c={c} only={r} />
          </>
        )}
        {tab === "ifs" && (
          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-max text-left text-[12px]">
              <thead className="text-pv-text-faint">
                <tr>
                  {["Interface", "To", "IS-IS", "Metric", "FRR", "TI-LFA", "Node-prot.", "BFD", "State"].map((h) => (
                    <th key={h} className="px-1">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t6Ifs(r).map((i) => {
                  const f = cfg.ifs[i.ifn]!;
                  const fr = t6Frr(s.cfg, r, i.ifn);
                  return (
                    <tr key={i.ifn} className="border-t border-pv-border/40">
                      <td className="px-1 py-0.5 pv-mono text-pv-text">{xrIf(i.ifn, true)}</td>
                      <td className="px-1 text-pv-text-muted">
                        {i.peer}
                        {i.link.silent ? " (DWDM)" : ""}
                      </td>
                      <td className="px-1">{box(f.isis, `isis ${i.ifn}`, (x) => void (x.ifs[i.ifn]!.isis = !f.isis))}</td>
                      <td className="px-1">
                        <select aria-label={`metric ${i.ifn}`} className="rounded border border-pv-border bg-pv-bg px-1 text-[12px] text-pv-text" value={f.metric} disabled={c.busy} onChange={(e) => change((x) => void (x.ifs[i.ifn]!.metric = +e.target.value))}>
                          {[...new Set([5, 10, 15, 20, 50, 70, 100, f.metric])].sort((a, b) => a - b).map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1">{box(f.frr, `frr ${i.ifn}`, (x) => void Object.assign(x.ifs[i.ifn]!, f.frr ? { frr: false, tilfa: false, node: false } : { frr: true }))}</td>
                      <td className="px-1">{box(f.tilfa, `tilfa ${i.ifn}`, (x) => void Object.assign(x.ifs[i.ifn]!, { tilfa: !f.tilfa, frr: true }))}</td>
                      <td className="px-1">{box(f.node, `node ${i.ifn}`, (x) => void Object.assign(x.ifs[i.ifn]!, { node: !f.node }))}</td>
                      <td className="px-1">{box(f.bfd, `bfd ${i.ifn}`, (x) => void (x.ifs[i.ifn]!.bfd = !f.bfd))}</td>
                      <td className={clsx("px-1", v.adj[i.link.id] ? "text-pv-success" : "text-pv-danger")}>
                        {v.adj[i.link.id] ? "Up" : "down"}
                        {fr.on && !fr.ti ? " · LFA only" : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {tab === "sids" && <Sids c={c} only={r} />}
        {tab === "term" && <SpConsole c={c.cli} sets={t6Sets(api, r)} os="iosxr" host={r} vendor={c.vendor} setVendor={c.setVendor} />}
        {tab === "log" && (
          <ul className="space-y-0.5">
            {s.sys.filter((x) => x.dev === r).slice(-30).reverse().map((x, i) => (
              <li key={i} className="pv-mono text-[11.5px] text-pv-text-muted">
                {spStamp(x.t).hms} {x.kind === "commit" ? "configuration committed" : x.kind === "frr" ? "FRR backups recomputed" : `IS-IS ${x.peer} ${x.kind === "adj-up" ? "Up" : "Down"}`}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Tools, composer
// ---------------------------------------------------------------------------------------------------------------
function LogTool({ c }: { c: Ctx }) {
  return (
    <ul className="space-y-0.5">
      {[...c.s.log].reverse().slice(0, 60).map((l, i) => (
        <li key={i} className={clsx("text-[12px]", l.tone === "warn" ? "text-pv-warning" : l.tone === "ok" ? "text-pv-success" : "text-pv-text-muted")}>
          <span className="pv-mono text-pv-text-faint">{spStamp(l.t).hms}</span> {l.text}
        </li>
      ))}
    </ul>
  );
}
function Composer({ c }: { c: Ctx }) {
  const sel = "rounded border border-pv-border bg-pv-bg px-1 py-0.5 text-[12px] text-pv-text";
  const [dr, setDr] = useState("P1-P2");
  const fail = DRILLS.find((x) => x.id === dr)!.fail;
  return (
    <div className="space-y-2 rounded-xl border border-pv-border p-2">
      <p className="text-[12px] font-semibold text-pv-text">Traffic: CUST-A over SRv6</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <Pill onClick={() => c.act({ type: "ping", dir: "fwd" })} disabled={c.busy} tone="primary">
          ping CE1 → CE2
        </Pill>
        <Pill onClick={() => c.act({ type: "ping", dir: "rev" })} disabled={c.busy}>
          ping CE2 → CE1
        </Pill>
      </div>
      <p className="text-[12px] font-semibold text-pv-text">Failure drill (the network itself doesn&apos;t change)</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <select aria-label="Drill" className={sel} value={dr} onChange={(e) => setDr(e.target.value)}>
          {DRILLS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
        <Pill onClick={() => c.act({ type: "drill", fail })} disabled={c.busy} tone="danger">
          run drill
        </Pill>
        <Pill onClick={() => c.act({ type: "drill", fail: { link: "P1-P2" }, naive: "plain" })} disabled={c.busy}>
          P1–P2 cut: plain reroute
        </Pill>
        <Pill onClick={() => c.act({ type: "drill", fail: { link: "P1-P2" }, naive: "p2end" })} disabled={c.busy}>
          P1–P2 cut: repair to P2&apos;s End
        </Pill>
        <Pill onClick={() => c.act({ type: "wipe-p1" })} disabled={c.busy} tone="danger">
          Remove P1&apos;s FRR
        </Pill>
      </div>
      <p className="text-[11.5px] text-pv-text-faint">The two hand-built repairs are experiments on P1 — what TI-LFA does not do.</p>
    </div>
  );
}

const SPEC: SpLabSpec<T6State, T6Action, T6Snap> = {
  title: "SRv6 TI-LFA Lab",
  note: () => "TI-LFA with SRv6 repair SIDs · IOS XR",
  fresh: (seq) => createT6Net(seq),
  vendors: ["cisco"],
  apply: t6Apply,
  snapOf: (s) => ({ view: s.view }),
  ticketAction: (id) => ({ type: "ticket", id: id as T6TicketId }),
  levels: T6_LEVELS,
  gate: {
    title: "You can operate SRv6 TI-LFA",
    points: [
      "The PLR is the router in front of the failure; it repairs locally, before the network converges.",
      "Until convergence other routers use stale tables — the repair must force its way past them.",
      "TI-LFA follows the post-convergence path, written as the PLR's outgoing interface plus End / End.X SIDs.",
      "End.X with USD removes the repair header and forces the adjacency; node protection avoids the next-hop router.",
      "Protection is per router and per direction, and only as fast as failure detection (BFD on silent links).",
    ],
    more: "The engineering workspace gives you every router in its own window (backups, interfaces with FRR and BFD, SIDs, an IOS XR console with commit), pings, drills on any link or router, two hand-built repairs to compare, five challenges and five tickets.",
  },
  stage,
  footer: (c) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
      <span>
        P1 → PE2 backup: <b className="pv-mono text-pv-text">{(() => { const p = t6Prot(c.live.view, "P1", "PE2"); return p?.backup ? `${p.backup.kind === "lfa" ? "LFA" : `TI-LFA ${p.backup.protect}`} [${p.backup.repair.map(short).join(", ") || "OIF only"}]` : "none"; })()}</b> · BFD P1–P2: <b className="text-pv-text">{c.s.cfg.P1.ifs["ge-0/0/1"]!.bfd && c.s.cfg.P2.ifs["ge-0/0/0"]!.bfd ? "up" : "down"}</b>
      </span>
      <span className="text-pv-text-faint">violet: normal path · amber: with a repair header</span>
    </div>
  ),
  devices: T6_ROUTERS,
  device: (id) => ({ label: id, icon: role(id), tone: "#22d3ee", sub: `${T6_LO(id as T6R)} · IOS XR` }),
  openFrom: 1,
  window: (id, c) => <RouterUI c={c} r={id as T6R} />,
  tools: [
    { id: "frr", label: "Backups", render: (c) => <Frr c={c} /> },
    { id: "drill", label: "Last drill", render: (c) => <DrillView c={c} /> },
    { id: "headers", label: "Headers, link by link", render: (c) => <Headers c={c} /> },
    { id: "sids", label: "Local SIDs", render: (c) => <Sids c={c} /> },
    { id: "path", label: "Last run, step by step", render: (c) => <PathView c={c} /> },
    { id: "log", label: "Log", render: (c) => <LogTool c={c} /> },
  ],
  toolsLabel: { learn: "What the routers know", eng: "Tools" },
  evidence,
  composer: (c) => <Composer c={c} />,
  investigate: [
    "On P1: show isis fast-reroute 2001:db8:110:2::/64 detail. What is the backup, and which SID does it push?",
    "Drill the P1–P2 cut, then a P2 failure. Compare the repair SIDs.",
    "Run the hand-built repair to P2's End. Why does it loop, when TI-LFA's doesn't?",
    "On P1: show bfd session. What would a DWDM failure cost without it?",
    "Drill the P1–P2 cut and look at CE2 → CE1: which router repairs the replies?",
  ],
  challenges: T6_CHALLENGES,
  tickets: T6_TICKETS.map((t) => ({ id: t.id, title: t.title, report: t.report, reproLabel: t.reproLabel, repro: t.repro })),
  ticketIntro: "Customers report outages measured in seconds or milliseconds after failures. Each ticket is this network after a change with one real thing wrong. Reproduce it with a drill, climb the ladder (the PLR, detection, its FRR config, its backup, the SIDs the repair needs), name the cause, fix it on the router, and prove it with a fresh drill.",
  reproHint: "Watch the PLR, the detection time and whether the repair is local.",
  fixHint: "Fix it on the router (its window or console — commit to apply), check its backups, then run the drill again.",
  causes: T6_CAUSES,
  feedback: t6CauseFeedback,
  proofs: t6Proofs,
  ladder: (s) => t6Ladder(s),
  text: (v, t) => spText(v, t),
  runCard: (c) => (
    <Card title="Result">
      {c.s.runs.at(-1)?.cmd.startsWith("Drill") ? <DrillView c={c} /> : <TestView c={c} />}
    </Card>
  ),
};

export function T6LabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SpLabWorkspace spec={SPEC} open={open} onClose={onClose} />;
}
