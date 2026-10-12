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
  HOSTS,
  SR_CAUSES,
  SR_IDX,
  SR_LINKS,
  SR_LO,
  SR_ROUTERS,
  SR_TICKETS,
  adjSidLabel,
  createSrNet,
  resolveNh,
  sidOf,
  srApply,
  srCapable,
  srCauseFeedback,
  srIfs,
  srLadder,
  srProofs,
  srgbOf,
  type IfName,
  type SrAction,
  type SrR,
  type SrRtr,
  type SrSnap,
  type SrState,
  type SrTicketId,
} from "@/lib/sim-engine/scenarios/srNet";
import { srPipe, srSets, type SrCliApi } from "./srCli";
import { SR_LEVELS } from "./srLearn";
import { SR_CHALLENGES } from "./srPractice";

/**
 * SR-MPLS Lab — the guided lesson's diamond (R1–R6) running IS-IS with segment routing and no LDP.
 *   LEARN                  6 levels (srLearn): labels from the IGP · following a Node SID · a Node SID follows the IGP ·
 *                          Adjacency SIDs · segment lists · when it breaks
 *   ENGINEERING WORKSPACE  Investigate (customer pings, segment lists from R1, router windows with the SR state and an
 *                          IOS XR / Junos console) · Challenges (five) · Troubleshoot (five tickets)
 * One model (srNet.ts) produces every SRGB, SID, label, path and verdict.
 */

type Ctx = SpCtx<SrState, SrAction, SrSnap>;
type Node = SrR | "H1" | "H6";
const POS: Record<Node, { x: number; y: number; cx: number; cy: number }> = {
  H1: { x: 5, y: 50, cx: 5, cy: 36 },
  R1: { x: 20, y: 50, cx: 20, cy: 36 },
  R2: { x: 42, y: 22, cx: 42, cy: 8 },
  R4: { x: 66, y: 22, cx: 66, cy: 8 },
  R3: { x: 42, y: 80, cx: 42, cy: 94 },
  R5: { x: 66, y: 80, cx: 66, cy: 94 },
  R6: { x: 82, y: 50, cx: 82, cy: 36 },
  H6: { x: 96, y: 50, cx: 96, cy: 36 },
};
const role = (d: string) => (d.startsWith("H") ? "CE" : d === "R1" || d === "R6" ? "PE" : "P");

function stage(c: Ctx, p: { moment?: SpMoment<SrSnap>; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) {
  const s = c.s;
  const v = c.live.view;
  const nodes: SpStageNode[] = (Object.keys(POS) as Node[]).map((d) => ({ id: d, label: d, role: role(d), tone: d.startsWith("H") ? "#34d399" : "#22d3ee", sub: d.startsWith("H") ? HOSTS[d as "H1" | "H6"].ip.replace("192.168.", "…") : SR_LO[d as SrR], ...POS[d] }));
  const links: SpStageLink[] = [
    { id: "H1-R1", a: "H1", b: "R1", state: "up", label: "LAN" },
    { id: "R6-H6", a: "R6", b: "H6", state: "up", label: "LAN" },
    ...SR_LINKS.map((l) => {
      const ma = s.cfg[l.a].ifs[l.ai]!.metric;
      const mb = s.cfg[l.b].ifs[l.bi]!.metric;
      return { id: l.id, a: l.a, b: l.b, state: (v.adj[l.id] ? "up" : "blocked") as SpStageLink["state"], label: v.adj[l.id] ? (ma === mb ? `${ma}` : `${ma} / ${mb}`) : "no IS-IS" };
    }),
  ];
  const views: Record<string, TopoView> = {};
  for (const r of SR_ROUTERS) {
    const sid = sidOf(v, r);
    const g = srgbOf(s.cfg[r], s.os);
    views[r] = { badge: { text: !srCapable(s.cfg[r], s.os) ? "no SR" : sid && g ? `${g.start + sid.index}` : "no SID", tone: srCapable(s.cfg[r], s.os) && sid ? "info" : "warn" } };
  }
  const paths: SpPath[] = [];
  const last = s.tests[s.tests.length - 1];
  if (last && !p.moment && last.cfgSeq === s.cfgSeq) paths.push({ id: "t", nodes: last.path.filter((x, i, a) => a.indexOf(x) === i), color: last.ok ? "#34d399" : "#f87171", offset: 0 });
  return <SpStage nodes={nodes} links={links} paths={paths} views={views} moment={p.moment} momentKey={p.momentKey} compact={p.compact} onNode={p.onNode} selected={p.selected} regions={[{ x: 13, y: 6, w: 76, h: 88, label: "IS-IS + SR-MPLS (no LDP)", color: "#22d3ee" }]} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------------------------
type Cell = string | [string, "ok" | "bad"];
function Sids({ c }: { c: Ctx }) {
  const v = c.live.view;
  const rows = SR_ROUTERS.map((r) => {
    const g = srgbOf(c.s.cfg[r], c.s.os);
    const sid = v.sids.find((x) => x.owner === r);
    return [r, `${SR_LO[r]}/32`, !srCapable(c.s.cfg[r], c.s.os) ? ["SR off", "bad"] : `${g!.start}–${g!.start + g!.range - 1}`, sid ? String(sid.index) : ["none", "bad"], sid?.lost ? [`conflict: ${sid.lost} keeps index ${sid.index}`, "bad"] : sid ? ["in use", "ok"] : "—"] as Cell[];
  });
  return <STable cols={["Router", "Loopback", "SRGB", "Prefix-SID index", "Status"]} rows={rows} />;
}
function Labels({ c }: { c: Ctx }) {
  const v = c.live.view;
  const owners = v.sids.filter((x) => !x.lost).map((x) => x.owner);
  const rows = SR_ROUTERS.map((r) => [r, ...owners.map((o) => {
    const g = srgbOf(c.s.cfg[r], c.s.os);
    const e = g ? v.table[r].find((x) => x.kind === "pfx" && x.to === o) : undefined;
    if (!e) return ["—", "bad"] as Cell;
    return (e.own ? `${e.label} (own)` : String(e.label)) as Cell;
  })]);
  return <STable cols={["Router", ...owners.map((o) => `${o} (idx ${sidOf(v, o)?.index})`)]} rows={rows as Cell[][]} empty="No Prefix-SID in use." />;
}
function Fwd({ c, only }: { c: Ctx; only?: SrR }) {
  const v = c.live.view;
  const rows = SR_ROUTERS.filter((r) => !only || r === only).flatMap((r) => [
    ...v.table[r].filter((e) => !e.own).map((e) => [r, String(e.label), e.kind === "adj" ? `Adj-SID → ${e.to}` : `Node SID ${e.to} (idx ${e.index})`, e.out === "Pop" ? "pop" : e.out === "Unlabelled" ? ["Unlabelled", "bad"] : `swap → ${e.out}`, e.nh ? `${e.nh.nh} (${ifName(c.vendor, e.nh.ifn)})` : "—"] as Cell[]),
    ...v.missing[r].map((m) => [r, "—", `Node SID ${m.owner} (idx ${m.index})`, [`no entry: ${m.why}`, "bad"], "—"] as Cell[]),
  ]);
  return <STable cols={["Router", "In label", "Segment", "Action", "Out to"]} rows={rows} empty="No label programmed." />;
}
function Adj({ c }: { c: Ctx }) {
  const v = c.live.view;
  const rows = SR_ROUTERS.flatMap((r) => v.table[r].filter((e) => e.kind === "adj").map((e) => [r, e.to, String(e.label), ifName(c.vendor, e.nh!.ifn), "local to " + r] as string[]));
  return <STable cols={["Owner", "Neighbor", "Adjacency SID", "Interface", "Significance"]} rows={rows} empty="No Adjacency SIDs." />;
}
function Igp({ c }: { c: Ctx }) {
  const v = c.live.view;
  const rows = SR_ROUTERS.filter((r) => r !== "R1").map((d) => {
    const rt = v.rib.R1.find((x) => x.dst === d);
    return [`R1 → ${d}`, rt ? String(rt.cost) : ["unreachable", "bad"], rt ? rt.path.join(" → ") : "—"] as Cell[];
  });
  const res = resolveNh(v, c.s.cfg, c.s.os, "R1", "R6");
  return (
    <div className="space-y-1">
      <STable cols={["Shortest path", "Cost", "Routers"]} rows={rows} />
      <p className="text-[11.5px] text-pv-text-muted">R1&apos;s customer route 192.168.6.0/24 (BGP next hop 10.0.0.6): {res.push ? `push ${res.push[0] ?? "nothing (PHP)"} toward ${res.nh!.nh}` : res.ip ? `plain IP toward ${res.nh!.nh} — ${res.why}` : `unusable — ${res.why}`}.</p>
    </div>
  );
}
function PathView({ c }: { c: Ctx }) {
  const run = [...c.s.runs].reverse().find((r) => r.kind === "test");
  if (!run) return <p className="text-[12px] text-pv-text-faint">Run a ping or send a segment list above.</p>;
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
  if (!t) return <p className="text-[12px] text-pv-text-faint">Run a ping or send a segment list above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The result appears when the run has finished.</p>;
  return (
    <div className={clsx("rounded-lg border px-2 py-1 text-[12.5px]", t.ok ? "border-pv-success/40" : "border-pv-danger/40")}>
      <p className="font-semibold text-pv-text">
        {t.kind === "ping" ? `ping ${t.dst} from ${t.from}` : `${t.from} → ${t.dst} with [${t.stack?.join(", ")}]`}: <span className={t.ok ? "text-pv-success" : "text-pv-danger"}>{t.ok ? "success" : "failed"}</span>
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
      {srLadder(c.s).map((r, i) => (
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
    case "sids":
      return card("SRGBs and Prefix-SIDs (from IS-IS)", <Sids c={c} />);
    case "labels":
      return card("The label each router uses for each Node SID", <Labels c={c} />);
    case "fwd":
      return card("Label tables", <Fwd c={c} />);
    case "adj":
      return card("Adjacency SIDs", <Adj c={c} />);
    case "igp":
      return card("IS-IS shortest paths from R1", <Igp c={c} />);
    case "path":
      return card("What each hop did", <PathView c={c} />);
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
function cfgDiff(a: SrRtr, b: SrRtr): string {
  const out: string[] = [];
  if (a.sr !== b.sr) out.push(`segment routing ${b.sr ? "on" : "off"}`);
  if (JSON.stringify(a.srgb) !== JSON.stringify(b.srgb)) out.push(b.srgb ? `SRGB ${b.srgb.start}–${b.srgb.start + b.srgb.range - 1}` : "SRGB removed");
  if (a.sid !== b.sid) out.push(b.sid !== undefined ? `Prefix-SID index ${b.sid}` : "Prefix-SID removed");
  if (a.lo !== b.lo) out.push(`loopback ${b.lo ? "in" : "out of"} IS-IS`);
  for (const k of new Set([...Object.keys(a.ifs), ...Object.keys(b.ifs)]) as Set<IfName>) {
    const x = a.ifs[k]!;
    const y = b.ifs[k]!;
    if (x.isis !== y.isis) out.push(`${k} IS-IS ${y.isis ? "on" : "off"}`);
    if (x.metric !== y.metric) out.push(`${k} metric ${y.metric}`);
    if (x.fam !== y.fam) out.push(`${k} family mpls ${y.fam ? "on" : "off"}`);
    if (x.mplsIf !== y.mplsIf) out.push(`${k} protocols mpls ${y.mplsIf ? "on" : "off"}`);
  }
  return out.join(", ") || "no change";
}
function devCli(c: Ctx, r: SrR): SpDevCli<SrRtr> {
  return {
    host: r,
    running: c.s.cfg[r],
    hist: c.s.hist[r],
    cand: c.cli.cand[r] as SrRtr | undefined,
    setCand: (x) => c.cli.setCand(r, x),
    xr: c.cli.xr[r] ?? [],
    setXr: (st) => c.cli.setXr(r, st),
    edit: !!c.cli.edit[r],
    setEdit: (b) => c.cli.setEdit(r, b),
    commit: (cfg, how) => c.act({ type: "cfg", dev: r, cfg, text: `${cfgDiff(c.s.cfg[r], cfg)} (${how}, ${c.vendor === "cisco" ? "IOS XR" : "Junos"})` }),
    ask: c.cli.setQuestion,
  };
}
type Tab = "sr" | "isis" | "term" | "log";
function RouterUI({ c, r }: { c: Ctx; r: SrR }) {
  const [tab, setTab] = useState<Tab>("sr");
  const s = c.s;
  const cfg = s.cfg[r];
  const v = c.live.view;
  const change = (f: (x: SrRtr) => void) => {
    const n = spClone(cfg);
    f(n);
    c.act({ type: "cfg", dev: r, cfg: n, text: `${cfgDiff(cfg, n)} (from ${r}'s window)` });
  };
  const api: SrCliApi = { s, act: c.act, dev: devCli(c, r) };
  const g = srgbOf(cfg, s.os);
  const sid = v.sids.find((x) => x.owner === r);
  return (
    <div>
      <Tabs tabs={[["sr", "Segment routing"], ["isis", "IS-IS & interfaces"], ["term", "Console"], ["log", "Log"]]} cur={tab} set={setTab} />
      <div className="space-y-2 p-3">
        {tab === "sr" && (
          <>
            <Card title={`${r} · ${SR_LO[r]}`}>
              <div className="grid gap-x-4 sm:grid-cols-2">
                <Kv k="Segment routing" v={cfg.sr ? (srCapable(cfg, s.os) ? "enabled" : "enabled, no SRGB") : "disabled"} tone={srCapable(cfg, s.os) ? undefined : "warn"} />
                <Kv k="SRGB" v={g ? `${g.start}–${g.start + g.range - 1}${cfg.srgb ? "" : " (default)"}` : "none"} tone={g ? undefined : "warn"} />
                <Kv k="Prefix-SID (loopback)" v={cfg.sid !== undefined ? `index ${cfg.sid}${sid?.lost ? ` — lost to ${sid.lost}` : g ? ` → ${g.start + cfg.sid}` : ""}` : "none"} tone={cfg.sid !== undefined && !sid?.lost ? undefined : "warn"} />
                <Kv k="Adjacency SIDs" v={v.table[r].filter((e) => e.kind === "adj").map((e) => `${e.label} → ${e.to}`).join(", ") || "none"} />
              </div>
            </Card>
            <Fwd c={c} only={r} />
            <p className="text-[11.5px] text-pv-text-faint">Segment routing is configured in the Console (candidate + commit).</p>
          </>
        )}
        {tab === "isis" && (
          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-max text-left text-[12px]">
              <thead className="text-pv-text-faint">
                <tr>
                  {["Interface", "To", "IS-IS", "Metric", ...(c.vendor === "juniper" ? ["family mpls", "protocols mpls"] : []), "Adjacency"].map((h) => (
                    <th key={h} className="px-1">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {srIfs(r).map((i) => {
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
                          {[...new Set([5, 10, 15, 20, 50, 100, f.metric])].sort((a, b) => a - b).map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </td>
                      {c.vendor === "juniper" && (
                        <>
                          <td className="px-1">
                            <input type="checkbox" aria-label={`family mpls ${i.ifn}`} checked={f.fam} disabled={c.busy} onChange={(e) => change((x) => void (x.ifs[i.ifn]!.fam = e.target.checked))} />
                          </td>
                          <td className="px-1">
                            <input type="checkbox" aria-label={`protocols mpls ${i.ifn}`} checked={f.mplsIf} disabled={c.busy} onChange={(e) => change((x) => void (x.ifs[i.ifn]!.mplsIf = e.target.checked))} />
                          </td>
                        </>
                      )}
                      <td className={clsx("px-1", v.adj[i.link.id] ? "text-pv-success" : "text-pv-danger")}>{v.adj[i.link.id] ? "Up" : "none"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {tab === "term" && <SpConsole c={c.cli} sets={srSets(api, r)} os={c.vendor === "cisco" ? "iosxr" : "junos"} host={r} vendor={c.vendor} setVendor={c.setVendor} pipeCtx={c.vendor === "juniper" ? srPipe(api, r) : undefined} />}
        {tab === "log" && (
          <ul className="space-y-0.5">
            {s.sys.filter((x) => x.dev === r).slice(-30).reverse().map((x, i) => (
              <li key={i} className="pv-mono text-[11.5px] text-pv-text-muted">
                {spStamp(x.t).hms} {x.kind === "commit" ? "configuration committed" : x.kind === "sid-conflict" ? `Prefix-SID conflict on index ${x.peer}` : x.kind === "srgb-range" ? `index ${x.peer} outside the SRGB` : `IS-IS ${x.peer} ${x.kind === "adj-up" ? "Up" : "Down"}`}
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
function Composer({ c }: { c: Ctx }) {
  const adj = adjSidLabel(c.s.os, "R3", "R5");
  const [list, setList] = useState(`16003, ${adj}, 16006`);
  const stack = list.split(/[\s,]+/).filter(Boolean).map(Number);
  const okList = stack.length > 0 && stack.length <= 6 && stack.every((x) => Number.isInteger(x) && x >= 16 && x <= 1048575);
  return (
    <div className="space-y-2 rounded-xl border border-pv-border p-2">
      <p className="text-[12px] font-semibold text-pv-text">Customer traffic</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <Pill onClick={() => c.act({ type: "ping", from: "H1" })} disabled={c.busy} tone="primary">
          ping H6 from H1
        </Pill>
        <Pill onClick={() => c.act({ type: "ping", from: "H6" })} disabled={c.busy}>
          ping H1 from H6
        </Pill>
      </div>
      <p className="text-[12px] font-semibold text-pv-text">A segment list from R1 (to 10.0.0.6)</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <input aria-label="Segment list" className="w-48 rounded border border-pv-border bg-pv-bg px-1.5 py-0.5 pv-mono text-[12px] text-pv-text" value={list} onChange={(e) => setList(e.target.value)} />
        <Pill onClick={() => c.act({ type: "probe", stack })} disabled={c.busy || !okList}>
          send
        </Pill>
        <span className="text-[11.5px] text-pv-text-faint">outermost first · R3→R5 Adj-SID = {adj}</span>
      </div>
      {!c.s.ticket && (
        <div className="flex flex-wrap items-center gap-2">
          <Pill onClick={() => c.act({ type: "wipe-r6" })} disabled={c.busy || !!c.s.wiped} tone="danger">
            Wipe R6&apos;s segment routing
          </Pill>
          <span className="text-[11.5px] text-pv-text-faint">for practice: rebuild it from the console</span>
        </div>
      )}
    </div>
  );
}

const SPEC: SpLabSpec<SrState, SrAction, SrSnap> = {
  title: "SR-MPLS Lab",
  note: () => "six routers · IS-IS with segment routing · no LDP",
  fresh: (seq, vendor) => createSrNet(seq, vendor === "cisco" ? "xr" : "junos"),
  vendorAction: (v) => ({ type: "os", os: v === "cisco" ? "xr" : "junos" }),
  apply: srApply,
  snapOf: (s) => ({ view: s.view }),
  ticketAction: (id) => ({ type: "ticket", id: id as SrTicketId }),
  levels: SR_LEVELS,
  gate: {
    title: "You can read SR-MPLS from the IGP up",
    points: [
      "IS-IS carries each router's SRGB and a Prefix-SID index for its loopback; label = SRGB start + index, computed by every router.",
      "A Node SID means “shortest path to this router”: transit routers swap to the next hop's label for the index, the penultimate hop pops.",
      "A Node SID follows the IGP: change a metric and the same label takes another path — no signaling.",
      "An Adjacency SID means “out of this link” and only works at the router that owns it.",
      "A segment list stacks them: bring the packet to R3 (16003), take R3's link (its Adj-SID), then reach R6 (16006).",
    ],
    more: "The engineering workspace gives you R1–R6 in their own windows (SR state, label table, interfaces and metrics, an IOS XR / Junos console with commit), customer pings, segment lists from R1, five challenges and five tickets.",
  },
  stage,
  footer: (c) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
      <span>
        Prefix-SIDs in use: <b className="pv-mono text-pv-text">{c.live.view.sids.filter((x) => !x.lost).length}/6</b> · conflicts {c.live.view.conflicts.length} · R1 → R6 cost {c.live.view.rib.R1.find((x) => x.dst === "R6")?.cost ?? "—"}
      </span>
      <span className="text-pv-text-faint">badges: the router&apos;s own Node SID label · link labels: IS-IS metrics</span>
    </div>
  ),
  devices: SR_ROUTERS,
  device: (id, c) => ({ label: id, icon: role(id), tone: "#22d3ee", sub: `${SR_LO[id as SrR]} · idx ${SR_IDX[id as SrR]} · ${c.vendor === "cisco" ? "IOS XR" : "Junos"} view` }),
  openFrom: 1,
  window: (id, c) => <RouterUI c={c} r={id as SrR} />,
  tools: [
    { id: "sids", label: "SRGBs and SIDs", render: (c) => <Sids c={c} /> },
    { id: "labels", label: "Node SID labels", render: (c) => <Labels c={c} /> },
    { id: "fwd", label: "Label tables", render: (c) => <Fwd c={c} /> },
    { id: "adj", label: "Adjacency SIDs", render: (c) => <Adj c={c} /> },
    { id: "igp", label: "Shortest paths", render: (c) => <Igp c={c} /> },
    { id: "path", label: "Last test, hop by hop", render: (c) => <PathView c={c} /> },
    { id: "log", label: "Log", render: (c) => <LogTool c={c} /> },
  ],
  toolsLabel: { learn: "What the routers know", eng: "Tools" },
  evidence,
  composer: (c) => <Composer c={c} />,
  investigate: [
    "On R1: show isis segment-routing label table (IOS XR) or show route table inet.3 (Junos). Where does each label come from?",
    "On R2: show mpls forwarding or show route table mpls.0. Which Node SIDs does R2 swap, which does it pop — and why?",
    "On R1: show isis database verbose / show isis database extensive. Find R6's SRGB and its Prefix-SID index.",
    "Send [16003, R3's Adj-SID toward R5, 16006] from R1. Then send it without 16003. What did R1 do with the first label?",
    "Raise the R2–R4 metric and ping again. Did R1 push a different label?",
  ],
  challenges: SR_CHALLENGES,
  tickets: SR_TICKETS.map((t) => ({ id: t.id, title: t.title, report: t.report, reproLabel: t.reproLabel, repro: t.repro })),
  ticketIntro: "Customers report symptoms, not causes. Each ticket is this network after a change with one real thing wrong. Reproduce it, walk the evidence (IS-IS, SR capability and SRGB, Prefix-SIDs, labels hop by hop, the customer route), name the cause, fix it on the router and prove it with a fresh ping.",
  reproHint: "Watch which label each hop holds — and where the packet stops being labeled.",
  fixHint: "Fix it on the router (its console — commit to apply), check the label tables, then ping again. IS-IS reachability alone proves nothing in a BGP-free core.",
  causes: SR_CAUSES,
  feedback: srCauseFeedback,
  proofs: srProofs,
  ladder: (s) => srLadder(s),
  text: (v, t) => spText(v, t),
  runCard: (c) => (
    <Card title="Result">
      <TestView c={c} />
    </Card>
  ),
};

export function SrLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SpLabWorkspace spec={SPEC} open={open} onClose={onClose} />;
}
