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
  CE_IDS,
  DOC,
  EB_CAUSES,
  EB_CES,
  EB_LINKS,
  EB_LO,
  EB_ROUTERS,
  EB_TICKETS,
  createEbNet,
  ebApply,
  ebCauseFeedback,
  ebIfs,
  ebLadder,
  ebProofs,
  famOf,
  locPrefix,
  v6norm,
  type CeId,
  type EbAction,
  type EbR,
  type EbRtr,
  type EbSnap,
  type EbState,
  type EbTicketId,
  type IfName,
  type Vrf,
} from "@/lib/sim-engine/scenarios/ebNet";
import { ebSets, type EbCliApi } from "./ebCli";
import { EB_LEVELS } from "./ebLearn";
import { EB_CHALLENGES } from "./ebPractice";

/**
 * SRv6 Endpoint Behaviors Lab — the guided lesson's network on IOS XR: End and End.X from IS-IS, End.DT4/DT6 or
 * End.DX4/DX6 from BGP for R6's VRFs, test traffic from R1 with explicit segment lists.
 *   LEARN                  6 levels (ebLearn): one table, many behaviors · End vs End.X · decapsulate and look up ·
 *                          the rules of the last segment · cross-connect instead of look up · when it breaks
 *   ENGINEERING WORKSPACE  Investigate (segment lists to three customers, router windows with SIDs, VRFs, interfaces and
 *                          an IOS XR console) · Challenges (five) · Troubleshoot (five tickets)
 * One model (ebNet.ts) produces every SID, behavior, lookup and verdict.
 */

type Ctx = SpCtx<EbState, EbAction, EbSnap>;
type Node = EbR | "H1" | CeId;
const POS: Record<Node, { x: number; y: number; cx: number; cy: number }> = {
  H1: { x: 5, y: 50, cx: 5, cy: 36 },
  R1: { x: 16, y: 50, cx: 16, cy: 36 },
  R2: { x: 34, y: 16, cx: 34, cy: 4 },
  R3: { x: 58, y: 16, cx: 58, cy: 4 },
  R4: { x: 34, y: 84, cx: 34, cy: 96 },
  R5: { x: 58, y: 84, cx: 58, cy: 96 },
  R6: { x: 78, y: 50, cx: 78, cy: 36 },
  CE6: { x: 95, y: 22, cx: 95, cy: 9 },
  "CE4-A": { x: 95, y: 50, cx: 95, cy: 37 },
  "CE4-B": { x: 95, y: 78, cx: 95, cy: 91 },
};
const role = (d: string) => (d.startsWith("H") || d.startsWith("CE") ? "CE" : d === "R1" || d === "R6" ? "PE" : "P");
const short = (x: string) => x.replace("2001:db8:100:", "…:");
const INNERS: { id: string; label: string }[] = [
  { id: "10.10.2.8", label: "10.10.2.8 (CE4-B)" },
  { id: "10.10.1.8", label: "10.10.1.8 (CE4-A)" },
  { id: "2001:db8:c6::6", label: "2001:db8:c6::6 (CE6)" },
];

function stage(c: Ctx, p: { moment?: SpMoment<EbSnap>; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) {
  const s = c.s;
  const v = c.live.view;
  const nodes: SpStageNode[] = (Object.keys(POS) as Node[]).map((d) => ({ id: d, label: d, role: role(d), tone: d.startsWith("H") || d.startsWith("CE") ? "#34d399" : "#22d3ee", sub: d === "H1" ? "…1::10" : d.startsWith("CE") ? EB_CES[d as CeId].ip.replace("2001:db8:", "…") : `…:${s.cfg[d as EbR].loc?.toString(16) ?? "–"}::/64`, ...POS[d] }));
  const links: SpStageLink[] = [
    { id: "H1-R1", a: "H1", b: "R1", state: "up" },
    ...CE_IDS.map((ce) => ({ id: `R6-${ce}`, a: "R6", b: ce, state: (s.cfg.R6.ceVrf[EB_CES[ce].ifn] ? "up" : "blocked") as SpStageLink["state"], label: s.cfg.R6.ceVrf[EB_CES[ce].ifn] ?? "no VRF" })),
    ...EB_LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b, state: (v.adj[l.id] ? "up" : "blocked") as SpStageLink["state"], label: v.adj[l.id] ? `${s.cfg[l.a].ifs[l.ai]!.metric}` : "no IS-IS" })),
  ];
  const views: Record<string, TopoView> = {};
  for (const r of EB_ROUTERS) {
    const n = v.sids[r].length;
    const svc = v.sids[r].filter((x) => x.vrf).map((x) => x.behavior.replace("End.", "")).join(" ");
    views[r] = { badge: { text: n ? (svc ? `${n} SIDs · ${svc}` : `${n} SIDs`) : "no SID", tone: n ? "info" : "warn" } };
  }
  const paths: SpPath[] = [];
  const t = s.tests[s.tests.length - 1];
  if (!p.moment && t && t.cfgSeq === s.cfgSeq) paths.push({ id: "t", nodes: t.path, color: !t.ok ? "#f87171" : t.sids.length > 1 ? "#a78bfa" : "#22d3ee", offset: 0 });
  return <SpStage nodes={nodes} links={links} paths={paths} views={views} moment={p.moment} momentKey={p.momentKey} compact={p.compact} onNode={p.onNode} selected={p.selected} regions={[{ x: 10, y: 4, w: 75, h: 92, label: "IS-IS IPv6 + SRv6", color: "#22d3ee" }]} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------------------------
type Cell = string | [string, "ok" | "bad" | "warn"];
const MEANS = (x: { behavior: string; peer?: string; vrf?: string; ce?: string }, vendor: Ctx["vendor"], ifn?: IfName) => (x.behavior === "End" ? "next segment, route normally" : x.behavior === "End.X" ? `next segment, out ${ifn ? ifName(vendor, ifn) : ""} to ${x.peer}` : x.behavior.startsWith("End.DT") ? `decapsulate, look up in VRF ${x.vrf}` : `decapsulate, send to ${x.ce}`);
function Sids({ c, only }: { c: Ctx; only?: EbR }) {
  const v = c.live.view;
  const rows = EB_ROUTERS.filter((r) => (only ? r === only : r === "R3" || r === "R6")).flatMap((r) => (v.sids[r].length ? v.sids[r].map((x) => [r, x.sid, x.behavior, MEANS(x, c.vendor, x.ifn), x.owner] as Cell[]) : [[r, ["none", "bad"], "—", "—", "—"] as Cell[]]));
  return (
    <div className="space-y-1">
      {!only && <p className="text-[11.5px] text-pv-text-faint">R3 and R6 (every router has End and End.X; open a router for its own table).</p>}
      <STable cols={["Router", "Local SID", "Behavior", "Means", "Allocated by"]} rows={rows} />
    </div>
  );
}
function Vrfs({ c }: { c: Ctx }) {
  const v = c.live.view;
  const rows = (["CUST4", "CUST6"] as Vrf[]).map((x) => {
    const af = c.s.cfg.R6.vrfs[x];
    const sids = v.sids.R6.filter((y) => y.vrf === x);
    return [x, af?.loc ? `${af.loc} · ${af.mode}` : ["no SRv6", "bad"], sids.length ? sids.map((y) => `${y.behavior}${y.ce ? `→${y.ce}` : ""} ${short(y.sid)}`).join(", ") : [v.vrfWhy[x] ?? "no SID", "bad"], v.vrfTable[x].length ? v.vrfTable[x].map((ce) => `${EB_CES[ce].net}/${EB_CES[ce].len} (${ce})`).join(", ") : ["empty", "bad"]] as Cell[];
  });
  return <STable cols={["VRF", "BGP SRv6", "Service SIDs", "Routes in the VRF"]} rows={rows} />;
}
function Headers({ c }: { c: Ctx }) {
  const t = c.s.tests[c.s.tests.length - 1];
  if (!t) return <p className="text-[12px] text-pv-text-faint">Send a test above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The headers appear when the run has finished.</p>;
  const rows = t.trace.map((h) => [h.from === h.to ? `at ${h.from}` : `${h.from} → ${h.to}`, h.outer ? short(h.da) : `inner → ${h.da}`, h.sl === undefined ? (h.outer ? "no SRH" : "—") : String(h.sl), h.list ? h.list.map((x, i) => `[${i}] ${short(x)}`).join(" ") : "—"] as Cell[]);
  return (
    <div className="space-y-1">
      <p className="text-[11.5px] text-pv-text-muted">segment list [{t.sids.map(short).join(", ")}] · inner IPv{famOf(t.inner)} to {t.inner}</p>
      <STable cols={["Where", "Destination address", "Segments Left", "SRH Segment List"]} rows={rows} />
    </div>
  );
}
function PathView({ c }: { c: Ctx }) {
  const run = [...c.s.runs].reverse().find((r) => r.kind === "test");
  if (!run) return <p className="text-[12px] text-pv-text-faint">Send a test above.</p>;
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
  if (!t) return <p className="text-[12px] text-pv-text-faint">Send a test above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The result appears when the run has finished.</p>;
  return (
    <div className={clsx("rounded-lg border px-2 py-1 text-[12.5px]", t.ok ? "border-pv-success/40" : "border-pv-danger/40")}>
      <p className="font-semibold text-pv-text">
        H1 → {t.inner} via [{t.sids.map(short).join(", ")}]: <span className={t.ok ? "text-pv-success" : "text-pv-danger"}>{t.ok ? `delivered to ${t.deliveredTo}` : t.deliveredTo ? `delivered to the wrong customer (${t.deliveredTo})` : "dropped"}</span>
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
      {ebLadder(c.s).map((r, i) => (
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
    case "sids":
      return card("Local SID tables", <Sids c={c} />);
    case "vrfs":
      return card("R6's VRFs and their service SIDs", <Vrfs c={c} />);
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
// Device windows
// ---------------------------------------------------------------------------------------------------------------
function cfgDiff(a: EbRtr, b: EbRtr): string {
  const out: string[] = [];
  if (a.sr6 !== b.sr6) out.push(`SRv6 ${b.sr6 ? "on" : "off"}`);
  if (a.loc !== b.loc) out.push(b.loc !== undefined ? `locator ${locPrefix(b.loc)}/64` : "locator removed");
  if (a.isisLoc !== b.isisLoc) out.push(`locator ${b.isisLoc ? "enabled" : "disabled"} in IS-IS`);
  for (const k of Object.keys(b.ifs) as IfName[]) {
    const x = a.ifs[k]!;
    const y = b.ifs[k]!;
    if (x.isis !== y.isis) out.push(`${k} IS-IS ${y.isis ? "on" : "off"}`);
    if (x.metric !== y.metric) out.push(`${k} metric ${y.metric}`);
  }
  for (const k of new Set([...Object.keys(a.ceVrf), ...Object.keys(b.ceVrf)]) as Set<IfName>) if (a.ceVrf[k] !== b.ceVrf[k]) out.push(`${k} vrf ${b.ceVrf[k] ?? "none"}`);
  for (const v of ["CUST4", "CUST6"] as Vrf[]) if (JSON.stringify(a.vrfs[v]) !== JSON.stringify(b.vrfs[v])) out.push(`VRF ${v} SRv6 ${b.vrfs[v]?.loc ? `${b.vrfs[v]!.loc} ${b.vrfs[v]!.mode}` : "none"}`);
  return out.join(", ") || "no change";
}
function devCli(c: Ctx, r: EbR): SpDevCli<EbRtr> {
  return {
    host: r,
    running: c.s.cfg[r],
    hist: c.s.hist[r],
    cand: c.cli.cand[r] as EbRtr | undefined,
    setCand: (x) => c.cli.setCand(r, x),
    xr: c.cli.xr[r] ?? [],
    setXr: (st) => c.cli.setXr(r, st),
    edit: !!c.cli.edit[r],
    setEdit: (b) => c.cli.setEdit(r, b),
    commit: (cfg, how) => c.act({ type: "cfg", dev: r, cfg, text: `${cfgDiff(c.s.cfg[r], cfg)} (${how}, IOS XR)` }),
    ask: c.cli.setQuestion,
  };
}
type Tab = "sids" | "ifs" | "term" | "log";
function RouterUI({ c, r }: { c: Ctx; r: EbR }) {
  const [tab, setTab] = useState<Tab>("sids");
  const s = c.s;
  const cfg = s.cfg[r];
  const v = c.live.view;
  const change = (f: (x: EbRtr) => void) => {
    const n = spClone(cfg);
    f(n);
    c.act({ type: "cfg", dev: r, cfg: n, text: `${cfgDiff(cfg, n)} (from ${r}'s window)` });
  };
  const api: EbCliApi = { s, act: c.act, dev: devCli(c, r) };
  return (
    <div>
      <Tabs tabs={[["sids", r === "R6" ? "SIDs & VRFs" : "SIDs"], ["ifs", "Interfaces"], ["term", "Console"], ["log", "Log"]]} cur={tab} set={setTab} />
      <div className="space-y-2 p-3">
        {tab === "sids" && (
          <>
            <Card title={`${r} · ${EB_LO(r)}`}>
              <div className="grid gap-x-4 sm:grid-cols-2">
                <Kv k="Locator MAIN" v={cfg.loc !== undefined ? `${locPrefix(cfg.loc)}/64` : "none"} />
                <Kv k="Enabled in IS-IS" v={cfg.isisLoc ? "yes" : "no"} tone={cfg.isisLoc ? undefined : "warn"} />
              </div>
              {r === "R6" && (
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-pv-text-muted">
                  VRF CUST4 alloc mode:
                  <select aria-label="CUST4 mode" className="rounded border border-pv-border bg-pv-bg px-1 text-[12px] text-pv-text" value={cfg.vrfs.CUST4?.mode ?? "per-vrf"} disabled={c.busy || !cfg.vrfs.CUST4} onChange={(e) => change((x) => void (x.vrfs.CUST4!.mode = e.target.value as "per-vrf" | "per-ce"))}>
                    <option value="per-vrf">per-vrf (End.DT4)</option>
                    <option value="per-ce">per-ce (End.DX4)</option>
                  </select>
                </div>
              )}
            </Card>
            <Sids c={c} only={r} />
            {r === "R6" && <Vrfs c={c} />}
          </>
        )}
        {tab === "ifs" && (
          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-max text-left text-[12px]">
              <thead className="text-pv-text-faint">
                <tr>
                  {["Interface", "To", "IS-IS", "Metric", "Adjacency"].map((h) => (
                    <th key={h} className="px-1">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ebIfs(r).map((i) => {
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
                          {[...new Set([5, 10, 20, 50, 100, f.metric])].sort((a, b) => a - b).map((m) => (
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
                {r === "R6" &&
                  CE_IDS.map((ce) => (
                    <tr key={ce} className="border-t border-pv-border/40">
                      <td className="px-1 py-0.5 pv-mono text-pv-text">{ifName(c.vendor, EB_CES[ce].ifn)}</td>
                      <td className="px-1 text-pv-text-muted">{ce}</td>
                      <td className="px-1 text-pv-text-faint" colSpan={2}>
                        <label className="flex items-center gap-1">
                          <input type="checkbox" aria-label={`vrf ${ce}`} checked={!!cfg.ceVrf[EB_CES[ce].ifn]} disabled={c.busy} onChange={(e) => change((x) => void (x.ceVrf[EB_CES[ce].ifn] = e.target.checked ? EB_CES[ce].vrf : undefined))} /> vrf {EB_CES[ce].vrf}
                        </label>
                      </td>
                      <td className="px-1 pv-mono text-pv-text-muted">{EB_CES[ce].gw}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === "term" && <SpConsole c={c.cli} sets={ebSets(api, r)} os="iosxr" host={r} vendor={c.vendor} setVendor={c.setVendor} />}
        {tab === "log" && (
          <ul className="space-y-0.5">
            {s.sys.filter((x) => x.dev === r).slice(-30).reverse().map((x, i) => (
              <li key={i} className="pv-mono text-[11.5px] text-pv-text-muted">
                {spStamp(x.t).hms} {x.kind === "commit" ? "configuration committed" : x.kind === "sid" ? "local SID table changed" : `IS-IS ${x.peer} ${x.kind === "adj-up" ? "Up" : "Down"}`}
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
const PRESETS: [string, string[]][] = [["CUST4", [DOC.dt4]], ["CUST6", [DOC.dt6]], ["R3 End, CUST4", [DOC.endR3, DOC.dt4]], ["R3 End.X→R4, CUST4", [DOC.endXR3R4, DOC.dt4]]];
function Composer({ c }: { c: Ctx }) {
  const [list, setList] = useState(DOC.dt4);
  const [inner, setInner] = useState(INNERS[0].id);
  const sids = list.split(/[\s,]+/).filter(Boolean);
  const okList = sids.length > 0 && sids.length <= 4 && sids.every((x) => !!v6norm(x));
  return (
    <div className="space-y-2 rounded-xl border border-pv-border p-2">
      <p className="text-[12px] font-semibold text-pv-text">Test traffic: R1 encapsulates H1&apos;s packet with a segment list</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <select aria-label="Inner destination" className="rounded border border-pv-border bg-pv-bg px-1 py-0.5 text-[12px] text-pv-text" value={inner} onChange={(e) => setInner(e.target.value)}>
          {INNERS.map((x) => (
            <option key={x.id} value={x.id}>
              to {x.label}
            </option>
          ))}
        </select>
        <input aria-label="Segment list" className="w-full max-w-md rounded border border-pv-border bg-pv-bg px-1.5 py-0.5 pv-mono text-[12px] text-pv-text" value={list} onChange={(e) => setList(e.target.value)} />
        <Pill onClick={() => c.act({ type: "send", sids, inner })} disabled={c.busy || !okList} tone="primary">
          send
        </Pill>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-pv-text-faint">
        Lists:
        {PRESETS.map(([l, x]) => (
          <button key={l} type="button" className="rounded border border-pv-border px-1.5 py-0.5 text-pv-text-muted hover:text-pv-text" onClick={() => setList(x.join(", "))}>
            [{l}]
          </button>
        ))}
        <span>(the documented SIDs — read R6&apos;s table if they change)</span>
      </div>
      {!c.s.ticket && (
        <div className="flex flex-wrap items-center gap-2">
          <Pill onClick={() => c.act({ type: "wipe-r6" })} disabled={c.busy || !!c.s.wiped} tone="danger">
            Wipe R6&apos;s services
          </Pill>
          <span className="text-[11.5px] text-pv-text-faint">for challenge 5: rebuild them from R6&apos;s console</span>
        </div>
      )}
    </div>
  );
}

const SPEC: SpLabSpec<EbState, EbAction, EbSnap> = {
  title: "SRv6 Endpoint Behaviors Lab",
  note: () => "End · End.X · End.DT4/DT6 · End.DX4 · IOS XR",
  fresh: (seq) => createEbNet(seq),
  vendors: ["cisco"],
  apply: ebApply,
  snapOf: (s) => ({ view: s.view }),
  ticketAction: (id) => ({ type: "ticket", id: id as EbTicketId }),
  levels: EB_LEVELS,
  gate: {
    title: "You can read what a SID does",
    points: [
      "The local SID table binds each SID to a behavior; IS-IS allocates End and End.X, BGP the service SIDs.",
      "End moves to the next segment and routes; End.X moves on and leaves through a chosen link.",
      "End.DT4/DT6 decapsulate and look the inner packet up in a VRF; End.DX4/DX6 decapsulate and send it to one CE.",
      "Decapsulation behaviors must be the last segment, and the inner family must match.",
      "Dynamic SIDs move when the configuration changes — read the table, not the runbook.",
    ],
    more: "The engineering workspace gives you R1–R6 in their own windows (SIDs, R6's VRFs and alloc mode, interfaces, an IOS XR console with commit), test traffic to three customers with the headers hop by hop, five challenges and five tickets.",
  },
  stage,
  footer: (c) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
      <span>
        R6 services: <b className="pv-mono text-pv-text">{c.live.view.sids.R6.filter((x) => x.vrf).map((x) => `${x.behavior}${x.ce ? `→${x.ce}` : ` ${x.vrf}`}`).join(", ") || "none"}</b>
      </span>
      <span className="text-pv-text-faint">badges: SIDs per router · violet path: several segments</span>
    </div>
  ),
  devices: EB_ROUTERS,
  device: (id) => ({ label: id, icon: role(id), tone: "#22d3ee", sub: `${EB_LO(id as EbR)} · IOS XR` }),
  openFrom: 1,
  window: (id, c) => <RouterUI c={c} r={id as EbR} />,
  tools: [
    { id: "sids", label: "Local SIDs", render: (c) => <Sids c={c} /> },
    { id: "vrfs", label: "R6's VRFs", render: (c) => <Vrfs c={c} /> },
    { id: "headers", label: "Headers, hop by hop", render: (c) => <Headers c={c} /> },
    { id: "path", label: "Last test, step by step", render: (c) => <PathView c={c} /> },
    { id: "log", label: "Log", render: (c) => <LogTool c={c} /> },
  ],
  toolsLabel: { learn: "What the routers know", eng: "Tools" },
  evidence,
  composer: (c) => <Composer c={c} />,
  investigate: [
    "On R6: show segment-routing srv6 sid, then show segment-routing srv6 sid 2001:db8:100:6:42:: detail. What does each SID do, and who allocated it?",
    "Send [R3 End, CUST4] and [R3 End.X→R4, CUST4] to 10.10.2.8. Compare the paths and the headers.",
    "Send the CUST4 SID to 10.10.1.8 and to 10.10.2.8. Who picked the customer?",
    "Send the CUST6 SID with an IPv4 packet inside. Then [CUST4, R3 End]. Why are both dropped at R6?",
    "Switch CUST4 to alloc mode per-ce and read R6's table again. Which SIDs moved?",
  ],
  challenges: EB_CHALLENGES,
  tickets: EB_TICKETS.map((t) => ({ id: t.id, title: t.title, report: t.report, reproLabel: t.reproLabel, repro: t.repro })),
  ticketIntro: "Testers report lost or misdelivered traffic, not causes. Each ticket is this network after a change with one real thing wrong. Reproduce it, walk the evidence (the SIDs and their behaviors, the order and family rules, R6's VRFs, the adjacencies), name the cause, fix it on the router and prove it with a fresh test.",
  reproHint: "Watch which behavior executes where — and what it does with the inner packet.",
  fixHint: "Fix it on the router (its window or its console — commit to apply), read the local SID tables again, then send the same test.",
  causes: EB_CAUSES,
  feedback: ebCauseFeedback,
  proofs: ebProofs,
  ladder: (s) => ebLadder(s),
  text: (v, t) => spText(v, t),
  runCard: (c) => (
    <Card title="Result">
      <TestView c={c} />
    </Card>
  ),
};

export function EbLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SpLabWorkspace spec={SPEC} open={open} onClose={onClose} />;
}
