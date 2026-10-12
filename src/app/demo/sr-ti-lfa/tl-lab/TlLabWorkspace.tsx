"use client";

import { useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { SpLabWorkspace, type SpCtx, type SpLabSpec } from "@/components/sp-lab/SpLabWorkspace";
import { SpStage, type SpPath, type SpStageLink, type SpStageNode } from "@/components/sp-lab/SpStage";
import { SpConsole } from "@/components/sp-lab/SpDesk";
import { Card, Kv, Pill, STable, Tabs } from "@/components/sp-lab/SpUi";
import { spClone, spStamp, type SpMoment } from "@/components/sp-lab/spKit";
import type { SpDevCli } from "@/components/sp-lab/spCli";
import { ifName, spText } from "@/components/sp-lab/spNames";
import type { TopoView } from "@/components/presentation/Visuals";
import {
  DETECT,
  TL_CAUSES,
  TL_HOSTS,
  TL_IDX,
  TL_LINKS,
  TL_LO,
  TL_ROUTERS,
  TL_TICKETS,
  createTlNet,
  lossText,
  tlApply,
  tlBackupStack,
  tlCauseFeedback,
  tlIfs,
  tlLadder,
  tlProofs,
  tlProt,
  type IfName,
  type TlAction,
  type TlFail,
  type TlR,
  type TlRtr,
  type TlSnap,
  type TlState,
  type TlTicketId,
} from "@/lib/sim-engine/scenarios/tlNet";
import { tlPipe, tlSets, type TlCliApi } from "./tlCli";
import { TL_LEVELS } from "./tlLearn";
import { TL_CHALLENGES } from "./tlPractice";

/**
 * SR TI-LFA Lab — the guided lesson's six routers running IS-IS with SR-MPLS, TI-LFA and BFD.
 *   LEARN                  6 levels (tlLearn): the cost of waiting · the post-convergence path · why classic LFA isn't
 *                          enough · switching in milliseconds · detection is half the outage · when it breaks
 *   ENGINEERING WORKSPACE  Investigate (customer pings, failure drills, router windows with per-interface protection,
 *                          backups and an IOS XR / Junos console) · Challenges (five) · Troubleshoot (five tickets)
 * One model (tlNet.ts) produces every path, backup, repair label, detection time and drill verdict.
 */

type Ctx = SpCtx<TlState, TlAction, TlSnap>;
type Node = TlR | "H1" | "H6";
const POS: Record<Node, { x: number; y: number; cx: number; cy: number }> = {
  H1: { x: 5, y: 50, cx: 5, cy: 36 },
  R1: { x: 18, y: 50, cx: 18, cy: 36 },
  R2: { x: 36, y: 50, cx: 36, cy: 36 },
  R4: { x: 62, y: 18, cx: 62, cy: 5 },
  R3: { x: 46, y: 84, cx: 46, cy: 97 },
  R5: { x: 70, y: 84, cx: 70, cy: 97 },
  R6: { x: 84, y: 50, cx: 84, cy: 36 },
  H6: { x: 96, y: 50, cx: 96, cy: 36 },
};
const role = (d: string) => (d.startsWith("H") ? "CE" : d === "R1" || d === "R6" ? "PE" : "P");
const protCount = (s: TlState, r: TlR) => {
  const ps = s.view.pfx[r].filter((p) => !p.own);
  return { prot: ps.filter((p) => p.backup).length, tot: ps.length };
};

function stage(c: Ctx, p: { moment?: SpMoment<TlSnap>; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) {
  const s = c.s;
  const v = c.live.view;
  const nodes: SpStageNode[] = (Object.keys(POS) as Node[]).map((d) => ({ id: d, label: d, role: role(d), tone: d.startsWith("H") ? "#34d399" : "#22d3ee", sub: d.startsWith("H") ? TL_HOSTS[d as "H1" | "H6"].ip.replace("192.168.", "…") : TL_LO[d as TlR], ...POS[d] }));
  const links: SpStageLink[] = [
    { id: "H1-R1", a: "H1", b: "R1", state: "up", label: "LAN" },
    { id: "R6-H6", a: "R6", b: "H6", state: "up", label: "LAN" },
    ...TL_LINKS.map((l) => {
      const ma = s.cfg[l.a].ifs[l.ai]!.metric;
      const mb = s.cfg[l.b].ifs[l.bi]!.metric;
      const m = ma === mb ? `${ma}` : `${ma} / ${mb}`;
      return { id: l.id, a: l.a, b: l.b, state: (v.adj[l.id] ? "up" : "blocked") as SpStageLink["state"], label: v.adj[l.id] ? (l.silent ? `${m} · DWDM` : m) : "no IS-IS" };
    }),
  ];
  const views: Record<string, TopoView> = {};
  for (const r of TL_ROUTERS) {
    const { prot, tot } = protCount(s, r);
    views[r] = { badge: { text: !s.cfg[r].sr ? "no SR" : `${prot}/${tot}`, tone: s.cfg[r].sr && (prot === tot || r === "R1") ? "info" : "warn" } };
  }
  const paths: SpPath[] = [];
  if (!p.moment) {
    const lastRun = s.runs[s.runs.length - 1];
    const d = s.drills[s.drills.length - 1];
    const t = s.tests[s.tests.length - 1];
    if (lastRun?.kind === "drill" && d && d.cfgSeq === s.cfgSeq) {
      d.results.forEach((r, i) => {
        if (r.affected && r.repairPath) paths.push({ id: `d${i}`, nodes: r.repairPath.filter((x, k, a) => k === 0 || a[k - 1] !== x), color: r.how === "local" ? "#fbbf24" : "#f87171", dashed: r.how !== "local", offset: i ? 1.4 : -1.4 });
      });
    } else if (t && t.cfgSeq === s.cfgSeq) paths.push({ id: "t", nodes: t.path, color: t.ok ? "#34d399" : "#f87171", offset: 0 });
  }
  return <SpStage nodes={nodes} links={links} paths={paths} views={views} moment={p.moment} momentKey={p.momentKey} compact={p.compact} onNode={p.onNode} selected={p.selected} regions={[{ x: 12, y: 4, w: 78, h: 92, label: "IS-IS + SR-MPLS + TI-LFA", color: "#22d3ee" }]} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------------------------
type Cell = string | [string, "ok" | "bad" | "warn"];
function Backups({ c, only, all }: { c: Ctx; only?: TlR; all?: boolean }) {
  const [every, setEvery] = useState(!!all);
  const s = c.s;
  const v = c.live.view;
  const rows = TL_ROUTERS.filter((r) => !only || r === only).flatMap((r) =>
    v.pfx[r]
      .filter((p) => !p.own && (every || only || p.dst === "R1" || p.dst === "R6"))
      .sort((a, b) => TL_IDX[a.dst] - TL_IDX[b.dst])
      .map((p) => {
        const b = p.backup;
        const st = tlBackupStack(s.cfg, p);
        return [r, `${p.dst} (${p.label})`, `${p.nh!.nh} · ${ifName(c.vendor, p.nh!.ifn)}`, b ? [`${b.kind === "lfa" ? "LFA" : `TI-LFA (${b.protect})`} via ${b.nh.nh}`, "ok"] : [p.noBackup ? `none — ${p.noBackup}` : "none (no fast reroute)", "warn"], b ? (b.kind === "lfa" ? "—" : `[${b.repair.join(", ") || "no repair label"}]${b.pq ? ` · PQ ${b.pq}` : ""}`) : "—", b ? (st.length ? st.join(" | ") : "(PHP)") : "—", b ? b.path.join("→") : "—"] as Cell[];
      }),
  );
  return (
    <div className="space-y-1">
      {!only && (
        <label className="flex items-center gap-1 text-[11.5px] text-pv-text-muted">
          <input type="checkbox" checked={every} onChange={(e) => setEvery(e.target.checked)} /> every destination (default: the PE loopbacks R1 and R6)
        </label>
      )}
      <STable cols={["PLR", "Destination", "Primary", "Backup", "Repair · PQ", "Labels on the backup", "Post-convergence path"]} rows={rows} empty="No SR prefixes." />
    </div>
  );
}
function Bfd({ c }: { c: Ctx }) {
  const s = c.s;
  const rows = TL_LINKS.map((l) => {
    const a = s.cfg[l.a].ifs[l.ai]!.bfd;
    const b = s.cfg[l.b].ifs[l.bi]!.bfd;
    return [`${l.a}–${l.b}`, l.silent ? ["silent (DWDM)", "warn"] : "loss of light", `${l.a} ${a ? "on" : "off"} · ${l.b} ${b ? "on" : "off"}`, a && b && c.live.view.adj[l.id] ? ["Up", "ok"] : a || b ? ["Down", "bad"] : "—", l.silent ? (a && b ? `BFD: ${DETECT.bfd} ms` : [`IS-IS hold time: ${DETECT.isis / 1000} s`, "bad"]) : `${DETECT.light} ms`] as Cell[];
  });
  return <STable cols={["Link", "How a failure shows", "BFD", "Session", "Detection"]} rows={rows} />;
}
function Igp({ c }: { c: Ctx }) {
  const v = c.live.view;
  const rows = ([["R1", "R6"], ["R6", "R1"], ["R2", "R6"], ["R4", "R1"]] as [TlR, TlR][]).map(([a, b]) => {
    const rt = v.rib[a].find((x) => x.dst === b);
    return [`${a} → ${b}`, rt ? String(rt.cost) : ["unreachable", "bad"], rt ? rt.path.join(" → ") : "—"] as Cell[];
  });
  return <STable cols={["Shortest path", "Cost", "Routers"]} rows={rows} />;
}
function DrillView({ c }: { c: Ctx }) {
  const d = c.s.drills[c.s.drills.length - 1];
  if (!d) return <p className="text-[12px] text-pv-text-faint">Run a drill above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The result appears when the run has finished.</p>;
  return (
    <div className="space-y-1">
      <p className="text-[12.5px] font-semibold text-pv-text">
        Drill: {d.what.replace("-", "–")}
        {d.cfgSeq !== c.s.cfgSeq && <span className="ml-2 text-[11.5px] font-normal text-pv-warning">(before your last change)</span>}
      </p>
      {d.results.map((r) => {
        const good = !r.affected || (r.how === "local" && r.lossMs < 1000);
        return (
          <div key={r.flow} className={clsx("rounded-lg border px-2 py-1 text-[12px]", good ? "border-pv-success/40" : "border-pv-danger/40")}>
            <p className="text-pv-text">
              <b>{r.flow}</b>: <span className={good ? "text-pv-success" : "text-pv-danger"}>{!r.affected ? "not affected" : r.how === "local" ? (r.lossMs < 1000 ? "repaired locally" : "repaired locally, but late") : r.how === "lost" ? "lost until the failure is repaired" : "waited for convergence"}</span>
              {r.affected && r.how !== "lost" && <> — traffic lost {lossText(r.lossMs)}</>}
            </p>
            {r.affected && (
              <p className="text-[11.5px] text-pv-text-muted">
                PLR {r.plr} · detection {r.detect === "light" ? `loss of light (${DETECT.light} ms)` : r.detect === "bfd" ? `BFD (${DETECT.bfd} ms)` : `IS-IS hold time (${DETECT.isis / 1000} s)`} · {spText(c.vendor, r.why)}
              </p>
            )}
            {r.affected && r.repairPath && <p className="pv-mono text-[11px] text-pv-text-faint">{r.how === "local" ? "during the repair" : "afterwards"}: {r.repairPath.join(" → ")}</p>}
          </div>
        );
      })}
    </div>
  );
}
function PathView({ c }: { c: Ctx }) {
  const run = [...c.s.runs].reverse().find((r) => r.kind === "test" || r.kind === "drill");
  if (!run) return <p className="text-[12px] text-pv-text-faint">Run a ping or a drill above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The walk appears when the run has finished.</p>;
  return (
    <ol className="space-y-0.5">
      {run.moments.map((m, i) => (
        <li key={i} className={clsx("text-[12px]", m.lines[0]?.tone === "warn" || m.lines[0]?.tone === "bad" ? "text-pv-warning" : m.lines[0]?.tone === "ok" ? "text-pv-success" : "text-pv-text-muted")}>
          {m.tokens[0] && <span className="pv-mono text-pv-text-faint">[{m.tokens[0].label}] </span>}
          {spText(c.vendor, m.lines[0]?.text ?? "")}
        </li>
      ))}
    </ol>
  );
}
function TestView({ c }: { c: Ctx }) {
  const t = c.s.tests[c.s.tests.length - 1];
  if (!t) return <p className="text-[12px] text-pv-text-faint">Run a ping above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The result appears when the run has finished.</p>;
  return (
    <div className={clsx("rounded-lg border px-2 py-1 text-[12.5px]", t.ok ? "border-pv-success/40" : "border-pv-danger/40")}>
      <p className="font-semibold text-pv-text">
        ping {t.dst} from {t.from}: <span className={t.ok ? "text-pv-success" : "text-pv-danger"}>{t.ok ? "success" : "failed"}</span>
        <span className="ml-2 text-[11.5px] font-normal text-pv-text-muted">path {t.path.join(" → ")}</span>
      </p>
      {t.why && <p className="text-[11.5px] text-pv-warning">{spText(c.vendor, t.why)}</p>}
    </div>
  );
}
function Ladder({ c }: { c: Ctx }) {
  if (c.busy) return <p className="text-[12px] text-pv-text-faint">The ladder fills in when the run has finished.</p>;
  return (
    <ol className="space-y-1">
      {tlLadder(c.s).map((r, i) => (
        <li key={r.k} className="rounded-lg border border-pv-border/70 px-2 py-1 text-[12px]">
          <b className="text-pv-text">
            {i + 1}. {r.title}
          </b>{" "}
          <span className="text-pv-text-muted">{spText(c.vendor, r.text)}</span>
        </li>
      ))}
    </ol>
  );
}
function evidence(key: string, c: Ctx): ReactNode {
  const card = (t: string, body: ReactNode) => <Card title={t}>{body}</Card>;
  switch (key) {
    case "backups":
      return card("Backups each router computed", <Backups c={c} />);
    case "drill":
      return card("What the failure cost", <DrillView c={c} />);
    case "bfd":
      return card("Failure detection per link", <Bfd c={c} />);
    case "igp":
      return card("IS-IS shortest paths", <Igp c={c} />);
    case "path":
      return card("What happened, step by step", <PathView c={c} />);
    case "test":
      return card("What the traffic did", <TestView c={c} />);
    case "ladder":
      return card("The evidence ladder, read from the network", <Ladder c={c} />);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Device windows
// ---------------------------------------------------------------------------------------------------------------
function cfgDiff(a: TlRtr, b: TlRtr): string {
  const out: string[] = [];
  if (a.sr !== b.sr) out.push(`segment routing ${b.sr ? "on" : "off"}`);
  if (a.sid !== b.sid) out.push(b.sid !== undefined ? `Prefix-SID index ${b.sid}` : "Prefix-SID removed");
  if (a.pcl !== b.pcl) out.push(`use-post-convergence-lfa ${b.pcl ? "on" : "off"}`);
  if (a.spr !== b.spr) out.push(`use-source-packet-routing ${b.spr ? "on" : "off"}`);
  for (const k of Object.keys(b.ifs) as IfName[]) {
    const x = a.ifs[k]!;
    const y = b.ifs[k]!;
    if (x.isis !== y.isis) out.push(`${k} IS-IS ${y.isis ? "on" : "off"}`);
    if (x.metric !== y.metric) out.push(`${k} metric ${y.metric}`);
    if (x.frr !== y.frr) out.push(`${k} fast-reroute per-prefix ${y.frr ? "on" : "off"}`);
    if (x.lp !== y.lp) out.push(`${k} link-protection ${y.lp ? "on" : "off"}`);
    if (x.tilfa !== y.tilfa) out.push(`${k} TI-LFA ${y.tilfa ? "on" : "off"}`);
    if (x.node !== y.node) out.push(`${k} node protection ${y.node ? "on" : "off"}`);
    if (x.bfd !== y.bfd) out.push(`${k} BFD ${y.bfd ? "on" : "off"}`);
  }
  return out.join(", ") || "no change";
}
function devCli(c: Ctx, r: TlR): SpDevCli<TlRtr> {
  return {
    host: r,
    running: c.s.cfg[r],
    hist: c.s.hist[r],
    cand: c.cli.cand[r] as TlRtr | undefined,
    setCand: (x) => c.cli.setCand(r, x),
    xr: c.cli.xr[r] ?? [],
    setXr: (st) => c.cli.setXr(r, st),
    edit: !!c.cli.edit[r],
    setEdit: (b) => c.cli.setEdit(r, b),
    commit: (cfg, how) => c.act({ type: "cfg", dev: r, cfg, text: `${cfgDiff(c.s.cfg[r], cfg)} (${how}, ${c.vendor === "cisco" ? "IOS XR" : "Junos"})` }),
    ask: c.cli.setQuestion,
  };
}
type Tab = "prot" | "bk" | "term" | "log";
function RouterUI({ c, r }: { c: Ctx; r: TlR }) {
  const [tab, setTab] = useState<Tab>("prot");
  const s = c.s;
  const cfg = s.cfg[r];
  const v = c.live.view;
  const xr = c.vendor === "cisco";
  const change = (f: (x: TlRtr) => void) => {
    const n = spClone(cfg);
    f(n);
    c.act({ type: "cfg", dev: r, cfg: n, text: `${cfgDiff(cfg, n)} (from ${r}'s window)` });
  };
  const api: TlCliApi = { s, act: c.act, dev: devCli(c, r) };
  const { prot, tot } = protCount(s, r);
  const cols = xr ? ["per-prefix", "ti-lfa", "node-protecting", "BFD"] : ["link-protection", "post-convergence-lfa", "node-protection", "BFD"];
  return (
    <div>
      <Tabs tabs={[["prot", "Interfaces & protection"], ["bk", "Backups"], ["term", "Console"], ["log", "Log"]]} cur={tab} set={setTab} />
      <div className="space-y-2 p-3">
        {tab === "prot" && (
          <>
            <Card title={`${r} · ${TL_LO[r]}`}>
              <div className="grid gap-x-4 sm:grid-cols-2">
                <Kv k="Segment routing" v={cfg.sr ? `on · Node SID ${16000 + TL_IDX[r]}` : "off"} tone={cfg.sr ? undefined : "warn"} />
                <Kv k="Destinations with a backup" v={`${prot} of ${tot}`} tone={prot === tot ? undefined : "warn"} />
                {!xr && <Kv k="backup-spf-options" v={[cfg.pcl && "use-post-convergence-lfa", cfg.spr && "use-source-packet-routing"].filter(Boolean).join(", ") || "none"} tone={cfg.pcl && cfg.spr ? undefined : "warn"} />}
              </div>
            </Card>
            <div className="max-w-full overflow-x-auto">
              <table className="w-full min-w-max text-left text-[12px]">
                <thead className="text-pv-text-faint">
                  <tr>
                    {["Interface", "To", "IS-IS", "Metric", ...cols, "Protection", "Adjacency"].map((h) => (
                      <th key={h} className="px-1">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tlIfs(r).map((i) => {
                    const f = cfg.ifs[i.ifn]!;
                    const pr = tlProt(s.cfg, s.os, r, i.ifn);
                    const box = (label: string, val: boolean, fn: (x: TlRtr, b: boolean) => void) => (
                      <td className="px-1">
                        <input type="checkbox" aria-label={`${label} ${i.ifn}`} checked={val} disabled={c.busy} onChange={(e) => change((x) => fn(x, e.target.checked))} />
                      </td>
                    );
                    return (
                      <tr key={i.ifn} className="border-t border-pv-border/40">
                        <td className="px-1 py-0.5 pv-mono text-pv-text">{ifName(c.vendor, i.ifn)}</td>
                        <td className="px-1 text-pv-text-muted">
                          {i.peer}
                          {i.link.silent ? " (DWDM)" : ""}
                        </td>
                        {box("isis", f.isis, (x, b) => void (x.ifs[i.ifn]!.isis = b))}
                        <td className="px-1">
                          <select aria-label={`metric ${i.ifn}`} className="rounded border border-pv-border bg-pv-bg px-1 text-[12px] text-pv-text" value={f.metric} disabled={c.busy} onChange={(e) => change((x) => void (x.ifs[i.ifn]!.metric = +e.target.value))}>
                            {[...new Set([5, 10, 15, 20, 25, 30, 50, 100, f.metric])].sort((a, b) => a - b).map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        </td>
                        {xr ? box("per-prefix", f.frr, (x, b) => void (b ? (x.ifs[i.ifn]!.frr = true) : Object.assign(x.ifs[i.ifn]!, { frr: false, tilfa: false, node: false }))) : box("link-protection", f.lp, (x, b) => void (x.ifs[i.ifn]!.lp = b))}
                        {box(xr ? "ti-lfa" : "post-convergence-lfa", f.tilfa, (x, b) => void (b ? (x.ifs[i.ifn]!.tilfa = true) : Object.assign(x.ifs[i.ifn]!, xr ? { tilfa: false } : { tilfa: false, node: false })))}
                        {box(xr ? "node-protecting" : "node-protection", f.node, (x, b) => void Object.assign(x.ifs[i.ifn]!, xr ? { node: b } : b ? { node: true, tilfa: true } : { node: false }))}
                        {box("bfd", f.bfd, (x, b) => void (x.ifs[i.ifn]!.bfd = b))}
                        <td className={clsx("px-1", pr.ti ? "text-pv-success" : pr.on ? "text-pv-warning" : "text-pv-text-faint")}>{pr.ti ? `TI-LFA${pr.node ? " (node)" : " (link)"}` : pr.on ? "classic LFA" : "none"}</td>
                        <td className={clsx("px-1", v.adj[i.link.id] ? "text-pv-success" : "text-pv-danger")}>{v.adj[i.link.id] ? "Up" : "none"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11.5px] text-pv-text-faint">{xr ? "On IOS XR, ti-lfa and node-protecting only take effect under fast-reroute per-prefix." : "On Junos, post-convergence-lfa needs backup-spf-options use-post-convergence-lfa and use-source-packet-routing (the console)."}</p>
          </>
        )}
        {tab === "bk" && <Backups c={c} only={r} />}
        {tab === "term" && <SpConsole c={c.cli} sets={tlSets(api, r)} os={xr ? "iosxr" : "junos"} host={r} vendor={c.vendor} setVendor={c.setVendor} pipeCtx={xr ? undefined : tlPipe(api, r)} />}
        {tab === "log" && (
          <ul className="space-y-0.5">
            {s.sys.filter((x) => x.dev === r).slice(-30).reverse().map((x, i) => (
              <li key={i} className="pv-mono text-[11.5px] text-pv-text-muted">
                {spStamp(x.t).hms} {x.kind === "commit" ? "configuration committed" : x.kind === "bfd-down" ? `BFD session to ${x.peer} down` : x.kind === "frr" ? `traffic switched to the backup (failure toward ${x.peer})` : `IS-IS ${x.peer} ${x.kind === "adj-up" ? "Up" : "Down"}`}
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
          <span className="pv-mono text-pv-text-faint">{spStamp(l.t).hms}</span> {spText(c.vendor, l.text)}
        </li>
      ))}
    </ul>
  );
}
const DRILLS: { id: string; label: string; fail: TlFail }[] = [
  ...["R2-R4", "R4-R6", "R2-R3", "R3-R5", "R5-R6", "R1-R2"].map((id) => ({ id: `link:${id}`, label: `link ${id.replace("-", "–")}${TL_LINKS.find((l) => l.id === id)?.silent ? " (DWDM, silent)" : ""} fails`, fail: { link: id } })),
  ...(["R4", "R3", "R5"] as TlR[]).map((n) => ({ id: `node:${n}`, label: `router ${n} fails`, fail: { node: n } })),
];
function Composer({ c }: { c: Ctx }) {
  const [what, setWhat] = useState("link:R2-R4");
  const sel = "rounded border border-pv-border bg-pv-bg px-1 py-0.5 text-[12px] text-pv-text";
  const d = DRILLS.find((x) => x.id === what)!;
  return (
    <div className="space-y-2 rounded-xl border border-pv-border p-2">
      <p className="text-[12px] font-semibold text-pv-text">Traffic and failure drills</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <Pill onClick={() => c.act({ type: "ping" })} disabled={c.busy} tone="primary">
          ping H6 from H1
        </Pill>
        <select aria-label="Drill" className={sel} value={what} onChange={(e) => setWhat(e.target.value)}>
          {DRILLS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
        <Pill onClick={() => c.act({ type: "drill", fail: d.fail })} disabled={c.busy} tone="danger">
          Run the drill
        </Pill>
      </div>
      <p className="text-[11.5px] text-pv-text-faint">A drill measures H1 → H6 and H6 → H1 through the failure, lets IS-IS converge, then repairs the failure — the network is back to normal afterwards.</p>
      {!c.s.ticket && (
        <div className="flex flex-wrap items-center gap-2">
          <Pill onClick={() => c.act({ type: "wipe-r4" })} disabled={c.busy || !!c.s.wiped} tone="danger">
            Wipe R4&apos;s protection
          </Pill>
          <span className="text-[11.5px] text-pv-text-faint">for challenge 5: rebuild it from R4&apos;s console</span>
        </div>
      )}
    </div>
  );
}

const SPEC: SpLabSpec<TlState, TlAction, TlSnap> = {
  title: "SR TI-LFA Lab",
  note: () => "six routers · IS-IS with SR-MPLS · TI-LFA and BFD",
  fresh: (seq, vendor) => createTlNet(seq, vendor === "cisco" ? "xr" : "junos"),
  vendorAction: (v) => ({ type: "os", os: v === "cisco" ? "xr" : "junos" }),
  apply: tlApply,
  snapOf: (s) => ({ view: s.view }),
  ticketAction: (id) => ({ type: "ticket", id: id as TlTicketId }),
  levels: TL_LEVELS,
  gate: {
    title: "You can protect an SR network with TI-LFA",
    points: [
      "Without a precomputed backup, a failure costs detection plus a full IS-IS convergence.",
      "The router next to the failure (the PLR) precomputes the post-convergence path and installs it as a backup.",
      "TI-LFA encodes that path with as few segments as needed: a PQ node's Node SID, an Adjacency SID where the shortest path would stray.",
      "Classic LFA needs a loop-free neighbor; TI-LFA always finds a repair if any path exists — but every router on it must run SR.",
      "Detection starts the repair: loss of light in 10 ms, a silent failure only with BFD.",
    ],
    more: "The engineering workspace gives you R1–R6 in their own windows (per-interface fast reroute and BFD, the backups, an IOS XR / Junos console with commit), customer pings, failure drills, five challenges and five tickets.",
  },
  stage,
  footer: (c) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
      <span>
        R2 → R6 backup: <b className="pv-mono text-pv-text">{(() => { const p = c.live.view.pfx.R2.find((x) => x.dst === "R6"); return p?.backup ? `${p.backup.kind === "lfa" ? "LFA" : "TI-LFA"} via ${p.backup.nh.nh}${p.backup.repair.length ? ` [${p.backup.repair.join(", ")}]` : ""}` : "none"; })()}</b> · R4 → R1 backup:{" "}
        <b className="pv-mono text-pv-text">{(() => { const p = c.live.view.pfx.R4.find((x) => x.dst === "R1"); return p?.backup ? `${p.backup.kind === "lfa" ? "LFA" : "TI-LFA"} via ${p.backup.nh.nh}${p.backup.repair.length ? ` [${p.backup.repair.join(", ")}]` : ""}` : "none"; })()}</b>
      </span>
      <span className="text-pv-text-faint">badges: destinations with a backup · amber: repair during the last drill</span>
    </div>
  ),
  devices: TL_ROUTERS,
  device: (id, c) => ({ label: id, icon: role(id), tone: "#22d3ee", sub: `${TL_LO[id as TlR]} · ${c.vendor === "cisco" ? "IOS XR" : "Junos"} view` }),
  openFrom: 1,
  window: (id, c) => <RouterUI c={c} r={id as TlR} />,
  tools: [
    { id: "backups", label: "Backups", render: (c) => <Backups c={c} /> },
    { id: "drill", label: "Last drill", render: (c) => <DrillView c={c} /> },
    { id: "bfd", label: "Detection", render: (c) => <Bfd c={c} /> },
    { id: "igp", label: "Shortest paths", render: (c) => <Igp c={c} /> },
    { id: "path", label: "Last run, step by step", render: (c) => <PathView c={c} /> },
    { id: "log", label: "Log", render: (c) => <LogTool c={c} /> },
  ],
  toolsLabel: { learn: "What the routers know", eng: "Tools" },
  evidence,
  composer: (c) => <Composer c={c} />,
  investigate: [
    "On R2: show isis fast-reroute 10.0.0.6/32 detail (IOS XR) or show isis backup spf results (Junos). Which PQ node, which labels?",
    "On R2: show mpls forwarding labels 16006 detail or show route table mpls.0. Find the (!) backup row and its label stack.",
    "Drill R2–R4, then R4. Which routers repair each time, and why does detection differ?",
    "Switch R4's interface toward R2 to classic LFA only. Why does R4 lose its backup for 10.0.0.1 — and R2 not for 10.0.0.6?",
    "On R1: show isis fast-reroute summary. Why can R1 protect nothing?",
  ],
  challenges: TL_CHALLENGES,
  tickets: TL_TICKETS.map((t) => ({ id: t.id, title: t.title, report: t.report, reproLabel: t.reproLabel, repro: t.repro })),
  ticketIntro: "Users report outages, not causes. Each ticket is this network after a change with one real thing wrong. Reproduce it with the failure drill, walk the evidence (the PLR for each direction, detection, the backup it computed, the routers on the repair), name the cause, fix it on the router and prove it with a fresh drill.",
  reproHint: "Watch both directions: which router is the PLR, how long detection takes, and whether it switches to a backup.",
  fixHint: "Fix it on the router (its window, or its console — commit to apply), check its backups, then run the same drill again. A backup that exists isn't proof — a fresh drill is.",
  causes: TL_CAUSES,
  feedback: tlCauseFeedback,
  proofs: tlProofs,
  ladder: (s) => tlLadder(s),
  text: (v, t) => spText(v, t),
  runCard: (c, run) => <Card title="Result">{run.kind === "drill" ? <DrillView c={c} /> : <TestView c={c} />}</Card>,
};

export function TlLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SpLabWorkspace spec={SPEC} open={open} onClose={onClose} />;
}
