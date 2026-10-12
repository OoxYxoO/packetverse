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
  P_CAUSES,
  P_LINKS,
  P_LO,
  P_ROUTERS,
  P_RX,
  P_TICKETS,
  createPNet,
  llPol,
  pApply,
  pCauseFeedback,
  pIfs,
  pLadder,
  pProofs,
  pSid,
  sidOwner,
  v6norm,
  type IfName,
  type PAction,
  type PCand,
  type PPolicy,
  type PR,
  type PRtr,
  type PSnap,
  type PState,
  type PTicketId,
  type Rx,
} from "@/lib/sim-engine/scenarios/s6pNet";
import { p6Sets, type P6CliApi } from "./p6Cli";
import { P6_LEVELS } from "./p6Learn";
import { P6_CHALLENGES } from "./p6Practice";

/**
 * SRv6 Policy Lab — the guided lesson's network on IOS XR: policy LOW-LATENCY on R1 (color 100 → R6) with an explicit
 * and a dynamic candidate pushed by the controller, BGP color steering, R6's End.DT6 service SID.
 *   LEARN                  6 levels (p6Learn): intent and steering · two candidate paths · what goes on the wire · when a
 *                          candidate fails · the stale SID · when it breaks
 *   ENGINEERING WORKSPACE  Investigate (traffic to two receivers, link failures, a flap; the Controller window edits the
 *                          policy; router windows with SIDs, interfaces, delays and an IOS XR console) · Challenges (five)
 *                          · Troubleshoot (five tickets)
 * One model (s6pNet.ts) produces every SID, candidate, selection, path and latency.
 */

type Ctx = SpCtx<PState, PAction, PSnap>;
type Node = PR | "CL1" | Rx;
const POS: Record<Node, { x: number; y: number; cx: number; cy: number }> = {
  CL1: { x: 5, y: 50, cx: 5, cy: 36 },
  R1: { x: 18, y: 50, cx: 18, cy: 36 },
  R2: { x: 40, y: 16, cx: 40, cy: 4 },
  R4: { x: 66, y: 16, cx: 66, cy: 4 },
  R3: { x: 40, y: 84, cx: 40, cy: 96 },
  R5: { x: 66, y: 84, cx: 66, cy: 96 },
  R6: { x: 82, y: 50, cx: 82, cy: 36 },
  RX66: { x: 96, y: 34, cx: 96, cy: 21 },
  RX67: { x: 96, y: 66, cx: 96, cy: 79 },
};
const role = (d: string) => (d.startsWith("R") && d.length === 2 ? (d === "R1" || d === "R6" ? "PE" : "P") : "CE");
const short = (x: string) => x.replace("2001:db8:100:", "…:");

function stage(c: Ctx, p: { moment?: SpMoment<PSnap>; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) {
  const s = c.s;
  const v = c.live.view;
  const nodes: SpStageNode[] = (Object.keys(POS) as Node[]).map((d) => ({ id: d, label: d, role: role(d), tone: role(d) === "CE" ? "#34d399" : "#22d3ee", sub: d === "CL1" ? "client" : d.startsWith("RX") ? P_RX[d as Rx].ip.replace("2001:db8:", "…") : P_LO(d as PR).replace("2001:db8:", "…"), ...POS[d] }));
  const links: SpStageLink[] = [
    { id: "CL1-R1", a: "CL1", b: "R1", state: "up" },
    { id: "R6-RX66", a: "R6", b: "RX66", state: "up", label: s.cfg.R6.colorOut ? "color 100" : "no color" },
    { id: "R6-RX67", a: "R6", b: "RX67", state: "up" },
    ...P_LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b, state: (v.adj[l.id] ? "up" : "blocked") as SpStageLink["state"], label: v.adj[l.id] ? `${s.cfg[l.a].ifs[l.ai]!.metric} · ${s.cfg[l.a].ifs[l.ai]!.delay / 1000} ms` : "down" })),
  ];
  const pol = llPol(v);
  const views: Record<string, TopoView> = { R1: { badge: { text: pol?.active ? `LOW-LATENCY: ${pol.active.cand.pref}` : "LOW-LATENCY down", tone: pol?.active?.cand.kind === "explicit" ? "info" : "warn" } } };
  const paths: SpPath[] = [];
  const t = s.tests[s.tests.length - 1];
  if (!p.moment && t && t.cfgSeq === s.cfgSeq) paths.push({ id: "t", nodes: t.path, color: !t.ok ? "#f87171" : /^policy/.test(t.via) ? "#a78bfa" : "#34d399", offset: 0 });
  return <SpStage nodes={nodes} links={links} paths={paths} views={views} moment={p.moment} momentKey={p.momentKey} compact={p.compact} onNode={p.onNode} selected={p.selected} regions={[{ x: 11, y: 4, w: 78, h: 92, label: "IS-IS IPv6 + SRv6 · SR-TE", color: "#22d3ee" }]} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------------------------
type Cell = string | [string, "ok" | "bad" | "warn"];
function Policy({ c }: { c: Ctx }) {
  const p = llPol(c.live.view);
  if (!p) return <p className="text-[12px] text-pv-text-faint">No policy on R1.</p>;
  const rows = [...p.cands].sort((a, b) => b.cand.pref - a.cand.pref).map((k) => [String(k.cand.pref), k.cand.kind === "explicit" ? "explicit" : `dynamic (${k.cand.metric})`, k.valid ? (p.active === k ? ["active", "ok"] : "valid") : [`invalid — ${k.why}`, "bad"], k.sids.length ? k.sids.map(short).join(", ") : "—", k.path ? k.path.join("→") : "—"] as Cell[]);
  return (
    <div className="space-y-1">
      <p className="text-[12px] text-pv-text-muted">
        ⟨R1, color {p.pol.color}, end-point {p.pol.endpoint}⟩ · <b className={p.up ? "text-pv-success" : "text-pv-danger"}>{p.up ? "up" : "down"}</b> · binding SID {p.bsid ? short(p.bsid) : "—"}
      </p>
      <STable cols={["Pref", "Candidate", "State", "SIDs (before the service SID)", "Computed path"]} rows={rows} />
    </div>
  );
}
function Sids({ c, only }: { c: Ctx; only?: PR }) {
  const v = c.live.view;
  const rows = P_ROUTERS.filter((r) => (only ? r === only : ["R1", "R3", "R5", "R6"].includes(r))).flatMap((r) => (v.sids[r].length ? [...v.sids[r]].sort((a, b) => parseInt(a.sid.split(":")[4] || "0", 16) - parseInt(b.sid.split(":")[4] || "0", 16)).map((x) => [r, x.sid, x.behavior, x.peer ? `→ ${x.peer}` : x.policy ? `policy ${x.policy}` : x.behavior === "End.DT6" ? "global IPv6 table" : "this node"] as Cell[]) : [[r, ["none", "bad"], "—", "—"] as Cell[]]));
  return <STable cols={["Router", "Local SID", "Behavior", "Context"]} rows={rows} />;
}
function Headers({ c }: { c: Ctx }) {
  const t = c.s.tests[c.s.tests.length - 1];
  if (!t) return <p className="text-[12px] text-pv-text-faint">Send traffic above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The headers appear when the run has finished.</p>;
  const rows = t.trace.map((h) => [h.from === h.to ? `at ${h.from}` : `${h.from} → ${h.to}`, h.from === "CL1" || h.to.startsWith("RX") ? `inner → ${h.da}` : short(h.da), h.sl === undefined ? "—" : String(h.sl)] as Cell[]);
  return (
    <div className="space-y-1">
      <p className="text-[11.5px] text-pv-text-muted">
        to {t.to}: [{t.sids.map(short).join(", ")}] · {t.via}
      </p>
      <STable cols={["Where", "Destination address", "Segments Left"]} rows={rows} />
    </div>
  );
}
function PathView({ c }: { c: Ctx }) {
  const run = [...c.s.runs].reverse().find((r) => r.kind === "test");
  if (!run) return <p className="text-[12px] text-pv-text-faint">Send traffic above.</p>;
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
  if (!t) return <p className="text-[12px] text-pv-text-faint">Send traffic above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The result appears when the run has finished.</p>;
  return (
    <div className={clsx("rounded-lg border px-2 py-1 text-[12.5px]", t.ok ? "border-pv-success/40" : "border-pv-danger/40")}>
      <p className="font-semibold text-pv-text">
        CLIENT1 → {t.to}: <span className={t.ok ? "text-pv-success" : "text-pv-danger"}>{t.ok ? `delivered, ${t.ms} ms one way` : "lost"}</span>
        <span className="ml-2 text-[11.5px] font-normal text-pv-text-muted">path {t.path.join(" → ")}</span>
      </p>
      <p className="pv-mono text-[11.5px] text-pv-text-muted">{t.via}</p>
      {t.why && <p className="text-[11.5px] text-pv-warning">{t.why}</p>}
    </div>
  );
}
function Ladder({ c }: { c: Ctx }) {
  if (c.busy) return <p className="text-[12px] text-pv-text-faint">The ladder fills in when the run has finished.</p>;
  return (
    <ol className="space-y-1">
      {pLadder(c.s).map((r, i) => (
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
    case "policy":
      return card("Policy LOW-LATENCY on R1", <Policy c={c} />);
    case "sids":
      return card("Local SID tables", <Sids c={c} />);
    case "headers":
      return card("The packet, hop by hop", <Headers c={c} />);
    case "path":
      return card("What each router did", <PathView c={c} />);
    case "test":
      return card("What the traffic did", <TestView c={c} />);
    case "ladder":
      return card("The evidence ladder, read from the network", <Ladder c={c} />);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Controller and router windows
// ---------------------------------------------------------------------------------------------------------------
function ControllerUI({ c }: { c: Ctx }) {
  const cur = llPol(c.live.view)?.pol;
  const [draft, setDraft] = useState<PPolicy>(() => spClone(cur ?? { name: "LOW-LATENCY", color: 100, endpoint: P_LO("R6"), cands: [] }));
  const [sync, setSync] = useState(c.s.cfgSeq);
  if (sync !== c.s.cfgSeq && cur) {
    setDraft(spClone(cur));
    setSync(c.s.cfgSeq);
  }
  const upd = (f: (d: PPolicy) => void) => {
    const n = spClone(draft);
    f(n);
    setDraft(n);
  };
  const inp = "rounded border border-pv-border bg-pv-bg px-1.5 py-0.5 pv-mono text-[12px] text-pv-text";
  const validSids = (k: PCand) => (k.sids ?? []).every((x) => !!v6norm(x));
  const ok = draft.cands.length > 0 && !!v6norm(draft.endpoint) && draft.cands.every((k) => k.pref > 0 && (k.kind === "dynamic" || ((k.sids ?? []).length > 0 && validSids(k))));
  return (
    <div className="space-y-2 p-3">
      <Card title="Controller (PCE) · policies on R1">
        <p className="mb-1 text-[11.5px] text-pv-text-faint">The controller instantiates R1&apos;s SR policies over PCEP. Edit LOW-LATENCY and push it; R1 re-evaluates its candidates immediately.</p>
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-pv-text-muted">
          <label className="flex items-center gap-1">
            color <input aria-label="color" className={clsx(inp, "w-16")} value={draft.color} onChange={(e) => upd((d) => void (d.color = +e.target.value || 0))} />
          </label>
          <label className="flex items-center gap-1">
            end-point <input aria-label="end-point" className={clsx(inp, "w-36")} value={draft.endpoint} onChange={(e) => upd((d) => void (d.endpoint = e.target.value))} />
          </label>
        </div>
      </Card>
      {draft.cands.map((k, i) => (
        <Card key={i} title={`Candidate ${i + 1} · ${k.kind}`}>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-pv-text-muted">
            <label className="flex items-center gap-1">
              preference <input aria-label={`preference ${i + 1}`} className={clsx(inp, "w-16")} value={k.pref} onChange={(e) => upd((d) => void (d.cands[i].pref = +e.target.value || 0))} />
            </label>
            {k.kind === "dynamic" ? (
              <label className="flex items-center gap-1">
                metric
                <select aria-label={`metric ${i + 1}`} className={inp} value={k.metric ?? "delay"} onChange={(e) => upd((d) => void (d.cands[i].metric = e.target.value as "igp" | "delay"))}>
                  <option value="delay">delay</option>
                  <option value="igp">igp</option>
                </select>
              </label>
            ) : (
              <label className="flex w-full items-center gap-1">
                SIDs
                <input aria-label={`sids ${i + 1}`} className={clsx(inp, "w-full max-w-md")} value={(k.sids ?? []).join(", ")} onChange={(e) => upd((d) => void (d.cands[i].sids = e.target.value.split(/[\s,]+/).filter(Boolean)))} />
              </label>
            )}
            <Pill onClick={() => upd((d) => void d.cands.splice(i, 1))} tone="danger">
              remove
            </Pill>
          </div>
          {k.kind === "explicit" && (
            <p className="mt-1 text-[11px] text-pv-text-faint">
              {(k.sids ?? []).map((x) => {
                const o = sidOwner(c.live.view.sids, x);
                const sx = o ? pSid(c.live.view, o, x) : undefined;
                return `${short(x)}: ${sx ? `${sx.behavior}${sx.peer ? ` ${o}→${sx.peer}` : ` on ${o}`}` : v6norm(x) ? "not advertised" : "not an IPv6 address"}`;
              }).join(" · ")}
            </p>
          )}
        </Card>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Pill onClick={() => upd((d) => void d.cands.push({ pref: 150, kind: "explicit", sids: [] }))}>+ explicit</Pill>
        <Pill onClick={() => upd((d) => void d.cands.push({ pref: 50, kind: "dynamic", metric: "delay" }))}>+ dynamic</Pill>
        <Pill onClick={() => c.act({ type: "policy", pol: draft, text: `LOW-LATENCY: ${draft.cands.map((k) => `${k.pref} ${k.kind}${k.kind === "explicit" ? ` [${(k.sids ?? []).map(short).join(", ")}]` : ` (${k.metric})`}`).join(" · ")}, color ${draft.color}, end-point ${draft.endpoint}` })} disabled={c.busy || !ok} tone="primary">
          Push to R1
        </Pill>
        <Pill onClick={() => cur && setDraft(spClone(cur))} disabled={!cur}>
          revert
        </Pill>
        {!ok && <span className="text-[11.5px] text-pv-warning">every candidate needs a preference, and explicit ones valid SIDs</span>}
      </div>
    </div>
  );
}
function cfgDiff(a: PRtr, b: PRtr): string {
  const out: string[] = [];
  if (a.isisLoc !== b.isisLoc) out.push(`SRv6 locator ${b.isisLoc ? "enabled" : "disabled"} in IS-IS`);
  if (a.colorOut !== b.colorOut) out.push(`color export ${b.colorOut ? "on" : "off"}`);
  for (const k of Object.keys(b.ifs) as IfName[]) {
    const x = a.ifs[k]!;
    const y = b.ifs[k]!;
    if (x.isis !== y.isis) out.push(`${k} IS-IS ${y.isis ? "on" : "off"}`);
    if (x.metric !== y.metric) out.push(`${k} metric ${y.metric}`);
    if (x.delay !== y.delay) out.push(`${k} delay ${y.delay} µs`);
  }
  return out.join(", ") || "no change";
}
function devCli(c: Ctx, r: PR): SpDevCli<PRtr> {
  return {
    host: r,
    running: c.s.cfg[r],
    hist: c.s.hist[r],
    cand: c.cli.cand[r] as PRtr | undefined,
    setCand: (x) => c.cli.setCand(r, x),
    xr: c.cli.xr[r] ?? [],
    setXr: (st) => c.cli.setXr(r, st),
    edit: !!c.cli.edit[r],
    setEdit: (b) => c.cli.setEdit(r, b),
    commit: (cfg, how) => c.act({ type: "cfg", dev: r, cfg, text: `${cfgDiff(c.s.cfg[r], cfg)} (${how}, IOS XR)` }),
    ask: c.cli.setQuestion,
  };
}
type Tab = "sr" | "ifs" | "term" | "log";
function RouterUI({ c, r }: { c: Ctx; r: PR }) {
  const [tab, setTab] = useState<Tab>("sr");
  const s = c.s;
  const cfg = s.cfg[r];
  const v = c.live.view;
  const change = (f: (x: PRtr) => void) => {
    const n = spClone(cfg);
    f(n);
    c.act({ type: "cfg", dev: r, cfg: n, text: `${cfgDiff(cfg, n)} (from ${r}'s window)` });
  };
  const api: P6CliApi = { s, act: c.act, dev: devCli(c, r) };
  return (
    <div>
      <Tabs tabs={[["sr", r === "R1" ? "Policy & SIDs" : "SIDs"], ["ifs", "Interfaces"], ["term", "Console"], ["log", "Log"]]} cur={tab} set={setTab} />
      <div className="space-y-2 p-3">
        {tab === "sr" && (
          <>
            <Card title={`${r} · ${P_LO(r)}`}>
              <div className="grid gap-x-4 sm:grid-cols-2">
                <Kv k="SRv6 locator in IS-IS" v={cfg.isisLoc ? "MAIN" : "no"} tone={cfg.isisLoc ? undefined : "warn"} />
                {r === "R6" && <Kv k="Color export (route-policy SET-COLOR-100)" v={cfg.colorOut ? "on" : "off"} tone={cfg.colorOut ? undefined : "warn"} />}
              </div>
            </Card>
            {r === "R1" && <Policy c={c} />}
            <Sids c={c} only={r} />
          </>
        )}
        {tab === "ifs" && (
          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-max text-left text-[12px]">
              <thead className="text-pv-text-faint">
                <tr>
                  {["Interface", "To", "IS-IS", "Metric", "Delay (µs)", "Adjacency"].map((h) => (
                    <th key={h} className="px-1">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pIfs(r).map((i) => {
                  const f = cfg.ifs[i.ifn]!;
                  return (
                    <tr key={i.ifn} className="border-t border-pv-border/40">
                      <td className="px-1 py-0.5 pv-mono text-pv-text">{ifName(c.vendor, i.ifn)}</td>
                      <td className="px-1 text-pv-text-muted">{i.peer}</td>
                      <td className="px-1">
                        <input type="checkbox" aria-label={`isis ${i.ifn}`} checked={f.isis} disabled={c.busy} onChange={(e) => change((x) => void (x.ifs[i.ifn]!.isis = e.target.checked))} />
                      </td>
                      <td className="px-1">
                        <select aria-label={`metric ${i.ifn}`} className="rounded border border-pv-border bg-pv-bg px-1 text-[12px] text-pv-text" value={f.metric} disabled={c.busy} onChange={(e) => change((x) => void (x.ifs[i.ifn]!.metric = +e.target.value))}>
                          {[...new Set([10, 15, 20, 50, 100, f.metric])].sort((a, b) => a - b).map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1">
                        <select aria-label={`delay ${i.ifn}`} className="rounded border border-pv-border bg-pv-bg px-1 text-[12px] text-pv-text" value={f.delay} disabled={c.busy} onChange={(e) => change((x) => void (x.ifs[i.ifn]!.delay = +e.target.value))}>
                          {[...new Set([5000, 15000, 20000, 50000, f.delay])].sort((a, b) => a - b).map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={clsx("px-1", v.adj[i.link.id] ? "text-pv-success" : "text-pv-danger")}>{v.adj[i.link.id] ? "Up" : "none"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {tab === "term" && <SpConsole c={c.cli} sets={p6Sets(api, r)} os="iosxr" host={r} vendor={c.vendor} setVendor={c.setVendor} />}
        {tab === "log" && (
          <ul className="space-y-0.5">
            {s.sys.filter((x) => x.dev === r).slice(-30).reverse().map((x, i) => (
              <li key={i} className="pv-mono text-[11.5px] text-pv-text-muted">
                {spStamp(x.t).hms} {x.kind === "commit" ? "configuration committed" : x.kind === "policy" ? `policy ${x.peer} changed state` : `IS-IS ${x.peer} ${x.kind === "adj-up" ? "Up" : "Down"}`}
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
  const [lk, setLk] = useState("R3-R5");
  const up = c.live.view.adj[lk];
  return (
    <div className="space-y-2 rounded-xl border border-pv-border p-2">
      <p className="text-[12px] font-semibold text-pv-text">Traffic from CLIENT1</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <Pill onClick={() => c.act({ type: "send", to: "RX66" })} disabled={c.busy} tone="primary">
          send to RX66 (color 100)
        </Pill>
        <Pill onClick={() => c.act({ type: "send", to: "RX67" })} disabled={c.busy}>
          send to RX67
        </Pill>
      </div>
      <p className="text-[12px] font-semibold text-pv-text">Links</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <select aria-label="Link" className={sel} value={lk} onChange={(e) => setLk(e.target.value)}>
          {P_LINKS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.id.replace("-", "–")}
            </option>
          ))}
        </select>
        <Pill onClick={() => c.act({ type: "link", id: lk, up: !up })} disabled={c.busy} tone={up ? "danger" : undefined}>
          {up ? "fail it" : "restore it"}
        </Pill>
        <Pill onClick={() => c.act({ type: "flap" })} disabled={c.busy || !c.live.view.adj["R3-R5"]} tone="danger">
          Flap R3–R5
        </Pill>
        <span className="text-[11.5px] text-pv-text-faint">a flap: R3 may come back with a new End.X SID toward R5</span>
      </div>
      <p className="text-[11.5px] text-pv-text-faint">Policy changes are made in the Controller window (open it from the device list).</p>
    </div>
  );
}

const SPEC: SpLabSpec<PState, PAction, PSnap> = {
  title: "SRv6 Policy Lab",
  note: () => "policy LOW-LATENCY · controller-initiated · IOS XR",
  fresh: (seq) => createPNet(seq),
  vendors: ["cisco"],
  apply: pApply,
  snapOf: (s) => ({ view: s.view }),
  ticketAction: (id) => ({ type: "ticket", id: id as PTicketId }),
  levels: P6_LEVELS,
  gate: {
    title: "You can operate an SRv6 policy",
    points: [
      "A policy is ⟨headend, color, end-point⟩; traffic uses it only when steered — here by its BGP route's color.",
      "Candidates are explicit (a list of SIDs) or dynamic (computed on the TE database); the valid one with the highest preference is active.",
      "On the wire: the policy's SIDs, then the egress's service SID — endpoints execute, transit routes.",
      "A candidate is invalid when a SID in it doesn't exist — after a failure, or when a dynamic SID was re-allocated.",
      "A policy that is up can still carry nothing: check steering.",
    ],
    more: "The engineering workspace gives you R1–R6 in their own windows (SIDs, interfaces with metric and delay, an IOS XR console with commit), a Controller window to edit the policy, traffic to two receivers, link failures and flaps, five challenges and five tickets.",
  },
  stage,
  footer: (c) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
      <span>
        LOW-LATENCY: <b className="pv-mono text-pv-text">{llPol(c.live.view)?.active ? `${llPol(c.live.view)!.active!.cand.pref} ${llPol(c.live.view)!.active!.cand.kind} [${llPol(c.live.view)!.active!.sids.map(short).join(", ")}]` : "down"}</b> · service SID <b className="pv-mono text-pv-text">{short(c.live.view.service)}</b>
      </span>
      <span className="text-pv-text-faint">links: metric · delay · violet path: steered into the policy</span>
    </div>
  ),
  devices: [...P_ROUTERS, "PCE"],
  device: (id) => (id === "PCE" ? { label: "Controller", icon: "PE", tone: "#a78bfa", sub: "PCE · policies on R1" } : { label: id, icon: role(id), tone: "#22d3ee", sub: `${P_LO(id as PR)} · IOS XR` }),
  openFrom: 1,
  window: (id, c) => (id === "PCE" ? <ControllerUI c={c} /> : <RouterUI c={c} r={id as PR} />),
  tools: [
    { id: "policy", label: "Policy", render: (c) => <Policy c={c} /> },
    { id: "sids", label: "Local SIDs", render: (c) => <Sids c={c} /> },
    { id: "headers", label: "Headers, hop by hop", render: (c) => <Headers c={c} /> },
    { id: "path", label: "Last test, step by step", render: (c) => <PathView c={c} /> },
    { id: "log", label: "Log", render: (c) => <LogTool c={c} /> },
  ],
  toolsLabel: { learn: "What the routers know", eng: "Tools" },
  evidence,
  composer: (c) => <Composer c={c} />,
  investigate: [
    "On R1: show segment-routing traffic-eng policy. Which candidate is active, and which SIDs does each carry?",
    "On R1: show bgp ipv6 unicast 2001:db8:66::/64, then show cef ipv6 2001:db8:66::/64. Where does the service SID come from?",
    "Send to RX66 and RX67. Why do they take different paths?",
    "Fail R3–R5, read the policy again and send to RX66. Then restore it.",
    "Press Flap R3–R5 and compare R3's End.X SIDs with the explicit list.",
  ],
  challenges: P6_CHALLENGES,
  tickets: P_TICKETS.map((t) => ({ id: t.id, title: t.title, report: t.report, reproLabel: t.reproLabel, repro: t.repro })),
  ticketIntro: "Users report latency or the wrong path, not causes. Each ticket is this network after a change with one real thing wrong. Reproduce it, walk the evidence (steering, the policy and its candidates, the SIDs they name), name the cause, fix it — on the controller or the router — and prove it with fresh traffic.",
  reproHint: "Watch which candidate is active and which SIDs R1 pushes.",
  fixHint: "Fix it in the Controller window (policies) or on the router (its window or console — commit to apply), check the policy on R1, then send to RX66 again.",
  causes: P_CAUSES,
  feedback: pCauseFeedback,
  proofs: pProofs,
  ladder: (s) => pLadder(s),
  text: (v, t) => spText(v, t),
  runCard: (c) => (
    <Card title="Result">
      <TestView c={c} />
    </Card>
  ),
};

export function P6LabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SpLabWorkspace spec={SPEC} open={open} onClose={onClose} />;
}
