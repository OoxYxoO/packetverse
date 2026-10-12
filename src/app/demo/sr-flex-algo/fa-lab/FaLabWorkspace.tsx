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
  FA_CAUSES,
  FA_HOSTS,
  FA_IDX,
  FA_LINKS,
  FA_LO,
  FA_ROUTERS,
  FA_TICKETS,
  createFaNet,
  faApply,
  faCauseFeedback,
  faIfs,
  faLadder,
  faProofs,
  type Aff,
  type FaAction,
  type FaR,
  type FaRtr,
  type FaSnap,
  type FaState,
  type FaTicketId,
  type IfName,
} from "@/lib/sim-engine/scenarios/faNet";
import { faSets, type FaCliApi } from "./faCli";
import { FA_LEVELS } from "./faLearn";
import { FA_CHALLENGES } from "./faPractice";

/**
 * SR Flex-Algo Lab — the guided lesson's six routers and R3–R4 cross-link, IS-IS with SR-MPLS and Flex-Algo 128 on
 * IOS XR, R1 steering the low-latency app (H66, color 128) into policy LOW-LATENCY (sid-algorithm 128).
 *   LEARN                  6 levels (faLearn): one topology for everyone · a second topology · algorithm-specific SIDs ·
 *                          a definition, not a path · who decides the definition · when it breaks
 *   ENGINEERING WORKSPACE  Investigate (pings, label probes, router windows with Flex-Algo, links and an IOS XR console)
 *                          · Challenges (five) · Troubleshoot (five tickets)
 * One model (faNet.ts) produces every definition, topology, label, path and latency.
 */

type Ctx = SpCtx<FaState, FaAction, FaSnap>;
type Node = FaR | "H1" | "H6" | "H66";
const POS: Record<Node, { x: number; y: number; cx: number; cy: number }> = {
  H1: { x: 5, y: 50, cx: 5, cy: 36 },
  R1: { x: 18, y: 50, cx: 18, cy: 36 },
  R2: { x: 40, y: 18, cx: 40, cy: 5 },
  R4: { x: 66, y: 18, cx: 66, cy: 5 },
  R3: { x: 40, y: 82, cx: 40, cy: 95 },
  R5: { x: 66, y: 82, cx: 66, cy: 95 },
  R6: { x: 84, y: 50, cx: 84, cy: 36 },
  H6: { x: 96, y: 36, cx: 96, cy: 23 },
  H66: { x: 96, y: 66, cx: 96, cy: 79 },
};
const role = (d: string) => (d.startsWith("H") ? "CE" : d === "R1" || d === "R6" ? "PE" : "P");

function stage(c: Ctx, p: { moment?: SpMoment<FaSnap>; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) {
  const s = c.s;
  const v = c.live.view;
  const nodes: SpStageNode[] = (Object.keys(POS) as Node[]).map((d) => ({ id: d, label: d, role: role(d), tone: d.startsWith("H") ? "#34d399" : "#22d3ee", sub: d.startsWith("H") ? FA_HOSTS[d as "H1" | "H6" | "H66"].ip.replace("192.168.", "…") : FA_LO[d as FaR], ...POS[d] }));
  const links: SpStageLink[] = [
    { id: "H1-R1", a: "H1", b: "R1", state: "up", label: "LAN" },
    { id: "R6-H6", a: "R6", b: "H6", state: "up" },
    { id: "R6-H66", a: "R6", b: "H66", state: "up" },
    ...FA_LINKS.map((l) => {
      const fa = s.cfg[l.a].ifs[l.ai]!;
      const fb = s.cfg[l.b].ifs[l.bi]!;
      const d = (x?: number) => (x === undefined ? "–" : `${x / 1000}`);
      const delay = fa.delay === fb.delay ? `${d(fa.delay)} ms` : `${d(fa.delay)}/${d(fb.delay)} ms`;
      const aff = [...new Set([...fa.aff, ...fb.aff])].join("+");
      return { id: l.id, a: l.a, b: l.b, state: (v.adj[l.id] ? "up" : "blocked") as SpStageLink["state"], label: v.adj[l.id] ? `${fa.metric === fb.metric ? fa.metric : `${fa.metric}/${fb.metric}`} · ${delay}${aff ? ` · ${aff}` : ""}` : "no IS-IS" };
    }),
  ];
  const views: Record<string, TopoView> = {};
  for (const r of FA_ROUTERS) views[r] = { badge: { text: !s.cfg[r].sr ? "no SR" : s.cfg[r].fa[128] ? (v.fad[128]?.src === r ? "FA128 · FAD" : "FA128") : "algo 0", tone: s.cfg[r].fa[128] ? "info" : "warn" } };
  const paths: SpPath[] = [];
  const t = s.tests[s.tests.length - 1];
  if (!p.moment && t && t.cfgSeq === s.cfgSeq) paths.push({ id: "t", nodes: t.path, color: !t.ok ? "#f87171" : t.stack.some((l) => l >= 16100) ? "#a78bfa" : "#34d399", offset: 0 });
  return <SpStage nodes={nodes} links={links} paths={paths} views={views} moment={p.moment} momentKey={p.momentKey} compact={p.compact} onNode={p.onNode} selected={p.selected} regions={[{ x: 11, y: 4, w: 80, h: 92, label: "IS-IS + SR-MPLS + Flex-Algo", color: "#22d3ee" }]} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------------------------
type Cell = string | [string, "ok" | "bad" | "warn"];
function Fad({ c }: { c: Ctx }) {
  const s = c.s;
  const v = c.live.view;
  const algos = Object.keys(v.fad).map(Number);
  const rows = FA_ROUTERS.flatMap((r) =>
    Object.entries(s.cfg[r].fa).map(([a, d]) => [r, a, d.adv ? `advertised · priority ${d.prio}` : "participates only", d.mt, d.excl.length ? `exclude ${d.excl.join(", ")}` : d.incl.length ? `include ${d.incl.join(", ")}` : "none", v.fad[+a]?.src === r ? ["winner", "ok"] : d.adv ? ["loses", "warn"] : "—"] as Cell[]),
  );
  return (
    <div className="space-y-1">
      {algos.map((a) => {
        const f = v.fad[a];
        return (
          <p key={a} className="text-[12px] text-pv-text-muted">
            Flex-Algo {a}: {f ? <b className="text-pv-text">{`definition from ${f.src} — ${f.def.mt} metric${f.def.excl.length ? `, exclude ${f.def.excl.join(", ")}` : ""}${f.def.incl.length ? `, include ${f.def.incl.join(", ")}` : ""}, priority ${f.def.prio}`}</b> : <b className="text-pv-danger">no definition advertised — unusable</b>} · participating: {v.part[a].join(", ") || "none"}
          </p>
        );
      })}
      <STable cols={["Router", "Algo", "Definition", "Metric", "Affinity rule", "Election"]} rows={rows} empty="No router configures a Flex-Algo." />
    </div>
  );
}
function Paths({ c }: { c: Ctx }) {
  const v = c.live.view;
  const algos = [0, ...Object.keys(v.fad).map(Number)];
  const rows = algos.map((a) => {
    const rt = v.rib[a]?.R1.find((x) => x.dst === "R6");
    const ms = rt ? rt.path.slice(1).reduce((sum, x, i) => sum + FA_LINKS.find((l) => (l.a === rt.path[i] && l.b === x) || (l.b === rt.path[i] && l.a === x))!.ms, 0) : 0;
    return [a === 0 ? "0 (IGP)" : `${a} (${v.fad[a]?.def.mt ?? "—"})`, rt ? rt.path.join(" → ") : ["no path", "bad"], rt ? String(rt.cost) : "—", rt ? `${ms} ms` : "—"] as Cell[];
  });
  return <STable cols={["Algorithm", "R1 → R6", "Algorithm metric", "Real delay"]} rows={rows} />;
}
function Labels({ c, only }: { c: Ctx; only?: FaR }) {
  const v = c.live.view;
  const rows = FA_ROUTERS.filter((r) => !only || r === only).flatMap((r) => [
    ...v.table[r].filter((e) => !e.own && (only || e.dst === "R6")).map((e) => [r, String(e.label), `${e.dst} · algo ${e.algo}`, e.out === "Pop" ? "pop" : `swap → ${e.out}`, `${e.nh!.nh} (${ifName(c.vendor, e.nh!.ifn)})`] as Cell[]),
    ...v.missing[r].filter((m) => only || m.dst === "R6").map((m) => [r, "—", `${m.dst} · algo ${m.algo}`, [`no entry: ${m.why}`, "bad"], "—"] as Cell[]),
  ]);
  return <STable cols={["Router", "In label", "Prefix SID", "Action", "Out to"]} rows={rows} empty="No label programmed." />;
}
function Links({ c }: { c: Ctx }) {
  const v = c.live.view;
  const algos = Object.keys(v.fad).map(Number);
  const rows = FA_ROUTERS.flatMap((u) =>
    faIfs(u).map((i) => {
      const f = c.s.cfg[u].ifs[i.ifn]!;
      return [`${u} → ${i.peer}`, String(f.metric), f.delay === undefined ? ["none", "warn"] : `${f.delay} µs`, f.aff.join(", ") || "—", ...algos.map((a) => (v.edges[a][`${u}>${i.peer}`] === true ? ["in", "ok"] : [String(v.edges[a][`${u}>${i.peer}`]), "warn"]))] as Cell[];
    }),
  );
  return <STable cols={["Direction", "IGP metric", "Advertised delay", "Affinity", ...algos.map((a) => `In Flex-Algo ${a}?`)]} rows={rows} />;
}
function PathView({ c }: { c: Ctx }) {
  const run = [...c.s.runs].reverse().find((r) => r.kind === "test");
  if (!run) return <p className="text-[12px] text-pv-text-faint">Run a ping above.</p>;
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
        {t.kind === "ping" ? `ping ${t.dst} from H1` : `R1 → 10.0.0.6 with [${t.stack.join(", ")}]`}: <span className={t.ok ? "text-pv-success" : "text-pv-danger"}>{t.ok ? `delivered, ${t.ms} ms one way` : "failed"}</span>
      </p>
      <p className="pv-mono text-[11.5px] text-pv-text-muted">
        pushed [{t.stack.join(", ")}] · {t.via} · path {t.path.join(" → ")}
      </p>
      {t.why && <p className="text-[11.5px] text-pv-warning">{t.why}</p>}
    </div>
  );
}
function Ladder({ c }: { c: Ctx }) {
  if (c.busy) return <p className="text-[12px] text-pv-text-faint">The ladder fills in when the run has finished.</p>;
  return (
    <ol className="space-y-1">
      {faLadder(c.s).map((r, i) => (
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
    case "fad":
      return card("Flex-Algo definitions and participation", <Fad c={c} />);
    case "paths":
      return card("R1 → R6 in each algorithm", <Paths c={c} />);
    case "labels":
      return card("Labels for R6, per algorithm", <Labels c={c} />);
    case "links":
      return card("Link attributes and Flex-Algo topology", <Links c={c} />);
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
function cfgDiff(a: FaRtr, b: FaRtr): string {
  const out: string[] = [];
  if (a.sr !== b.sr) out.push(`segment routing ${b.sr ? "on" : "off"}`);
  if (a.sid !== b.sid) out.push(b.sid !== undefined ? `prefix-sid index ${b.sid}` : "prefix-sid removed");
  if (JSON.stringify(a.algoSid) !== JSON.stringify(b.algoSid)) out.push(`algorithm prefix SIDs ${Object.entries(b.algoSid).map(([x, i]) => `${x}:${i}`).join(", ") || "none"}`);
  if (JSON.stringify(a.fa) !== JSON.stringify(b.fa)) out.push(`flex-algo ${Object.entries(b.fa).map(([x, d]) => `${x} (${d.mt}${d.excl.length ? `, excl ${d.excl.join("+")}` : ""}${d.incl.length ? `, incl ${d.incl.join("+")}` : ""}${d.adv ? `, adv prio ${d.prio}` : ""})`).join("; ") || "none"}`);
  for (const k of Object.keys(b.ifs) as IfName[]) {
    const x = a.ifs[k]!;
    const y = b.ifs[k]!;
    if (x.isis !== y.isis) out.push(`${k} IS-IS ${y.isis ? "on" : "off"}`);
    if (x.metric !== y.metric) out.push(`${k} metric ${y.metric}`);
    if (x.delay !== y.delay) out.push(`${k} delay ${y.delay === undefined ? "none" : `${y.delay} µs`}`);
    if (x.aff.join() !== y.aff.join()) out.push(`${k} affinity ${y.aff.join("+") || "none"}`);
  }
  return out.join(", ") || "no change";
}
function devCli(c: Ctx, r: FaR): SpDevCli<FaRtr> {
  return {
    host: r,
    running: c.s.cfg[r],
    hist: c.s.hist[r],
    cand: c.cli.cand[r] as FaRtr | undefined,
    setCand: (x) => c.cli.setCand(r, x),
    xr: c.cli.xr[r] ?? [],
    setXr: (st) => c.cli.setXr(r, st),
    edit: !!c.cli.edit[r],
    setEdit: (b) => c.cli.setEdit(r, b),
    commit: (cfg, how) => c.act({ type: "cfg", dev: r, cfg, text: `${cfgDiff(c.s.cfg[r], cfg)} (${how}, IOS XR)` }),
    ask: c.cli.setQuestion,
  };
}
type Tab = "fa" | "links" | "term" | "log";
function RouterUI({ c, r }: { c: Ctx; r: FaR }) {
  const [tab, setTab] = useState<Tab>("fa");
  const s = c.s;
  const cfg = s.cfg[r];
  const v = c.live.view;
  const change = (f: (x: FaRtr) => void) => {
    const n = spClone(cfg);
    f(n);
    c.act({ type: "cfg", dev: r, cfg: n, text: `${cfgDiff(cfg, n)} (from ${r}'s window)` });
  };
  const api: FaCliApi = { s, act: c.act, dev: devCli(c, r) };
  const d = cfg.fa[128];
  return (
    <div>
      <Tabs tabs={[["fa", "Flex-Algo"], ["links", "Interfaces"], ["term", "Console"], ["log", "Log"]]} cur={tab} set={setTab} />
      <div className="space-y-2 p-3">
        {tab === "fa" && (
          <>
            <Card title={`${r} · ${FA_LO[r]}`}>
              <div className="grid gap-x-4 sm:grid-cols-2">
                <Kv k="Segment routing" v={cfg.sr ? "on" : "off"} tone={cfg.sr ? undefined : "warn"} />
                <Kv k="Prefix SIDs (Loopback0)" v={[cfg.sid !== undefined ? `algo 0: ${16000 + cfg.sid}` : "algo 0: none", ...Object.entries(cfg.algoSid).map(([a, i]) => `algo ${a}: ${16000 + i}`)].join(" · ")} tone={cfg.algoSid[128] === undefined ? "warn" : undefined} />
                <Kv k="Flex-Algo 128" v={d ? `participates${d.adv ? `, advertises (priority ${d.prio}, ${d.mt}${d.excl.length ? `, exclude ${d.excl.join(", ")}` : ""})` : ""}` : "does not participate"} tone={d ? undefined : "warn"} />
                <Kv k="Winning definition" v={v.fad[128] ? `${v.fad[128].src}, priority ${v.fad[128].def.prio}` : "none"} tone={v.fad[128] ? undefined : "warn"} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-pv-text-muted">
                <label className="flex items-center gap-1">
                  <input type="checkbox" aria-label="participate 128" checked={!!d} disabled={c.busy} onChange={(e) => change((x) => void (e.target.checked ? (x.fa[128] = { prio: 128, mt: "delay", excl: ["BLUE"], incl: [], adv: false }) : delete x.fa[128]))} /> flex-algo 128
                </label>
                <label className="flex items-center gap-1">
                  <input type="checkbox" aria-label="advertise 128" checked={!!d?.adv} disabled={c.busy || !d} onChange={(e) => change((x) => void (x.fa[128].adv = e.target.checked))} /> advertise-definition
                </label>
                <label className="flex items-center gap-1">
                  <input type="checkbox" aria-label="algo sid 128" checked={cfg.algoSid[128] !== undefined} disabled={c.busy} onChange={(e) => change((x) => void (e.target.checked ? (x.algoSid[128] = 100 + FA_IDX[r]) : delete x.algoSid[128]))} /> prefix-sid algorithm 128 index {100 + FA_IDX[r]}
                </label>
              </div>
            </Card>
            <Labels c={c} only={r} />
            <p className="text-[11.5px] text-pv-text-faint">The definition&apos;s metric type, priority and affinity rules are configured in the Console (router isis CORE → flex-algo 128).</p>
          </>
        )}
        {tab === "links" && (
          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-max text-left text-[12px]">
              <thead className="text-pv-text-faint">
                <tr>
                  {["Interface", "To", "IS-IS", "Metric", "Delay (µs)", "BLUE", "GOLD", "Adjacency"].map((h) => (
                    <th key={h} className="px-1">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {faIfs(r).map((i) => {
                  const f = cfg.ifs[i.ifn]!;
                  const aff = (a: Aff) => (
                    <td className="px-1">
                      <input type="checkbox" aria-label={`${a} ${i.ifn}`} checked={f.aff.includes(a)} disabled={c.busy} onChange={(e) => change((x) => void (x.ifs[i.ifn]!.aff = e.target.checked ? [...new Set([...x.ifs[i.ifn]!.aff, a])].sort() : x.ifs[i.ifn]!.aff.filter((y) => y !== a)))} />
                    </td>
                  );
                  return (
                    <tr key={i.ifn} className="border-t border-pv-border/40">
                      <td className="px-1 py-0.5 pv-mono text-pv-text">{ifName(c.vendor, i.ifn)}</td>
                      <td className="px-1 text-pv-text-muted">{i.peer}</td>
                      <td className="px-1">
                        <input type="checkbox" aria-label={`isis ${i.ifn}`} checked={f.isis} disabled={c.busy} onChange={(e) => change((x) => void (x.ifs[i.ifn]!.isis = e.target.checked))} />
                      </td>
                      <td className="px-1">
                        <select aria-label={`metric ${i.ifn}`} className="rounded border border-pv-border bg-pv-bg px-1 text-[12px] text-pv-text" value={f.metric} disabled={c.busy} onChange={(e) => change((x) => void (x.ifs[i.ifn]!.metric = +e.target.value))}>
                          {[...new Set([5, 10, 20, 30, 50, 100, f.metric])].sort((a, b) => a - b).map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1">
                        <select aria-label={`delay ${i.ifn}`} className="rounded border border-pv-border bg-pv-bg px-1 text-[12px] text-pv-text" value={f.delay ?? ""} disabled={c.busy} onChange={(e) => change((x) => void (x.ifs[i.ifn]!.delay = e.target.value === "" ? undefined : +e.target.value))}>
                          {[...new Set([3000, 5000, 30000, 80000, ...(f.delay !== undefined ? [f.delay] : [])])].sort((a, b) => a - b).map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                          <option value="">none</option>
                        </select>
                      </td>
                      {aff("BLUE")}
                      {aff("GOLD")}
                      <td className={clsx("px-1", v.adj[i.link.id] ? "text-pv-success" : "text-pv-danger")}>{v.adj[i.link.id] ? "Up" : "none"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {tab === "term" && <SpConsole c={c.cli} sets={faSets(api, r)} os="iosxr" host={r} vendor={c.vendor} setVendor={c.setVendor} />}
        {tab === "log" && (
          <ul className="space-y-0.5">
            {s.sys.filter((x) => x.dev === r).slice(-30).reverse().map((x, i) => (
              <li key={i} className="pv-mono text-[11.5px] text-pv-text-muted">
                {spStamp(x.t).hms} {x.kind === "commit" ? "configuration committed" : x.kind === "fad" ? `Flex-Algo ${x.peer} definition changed` : `IS-IS ${x.peer} ${x.kind === "adj-up" ? "Up" : "Down"}`}
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
  const [list, setList] = useState("16106");
  const stack = list.split(/[\s,]+/).filter(Boolean).map(Number);
  const okList = stack.length > 0 && stack.length <= 4 && stack.every((x) => Number.isInteger(x) && x >= 16 && x <= 1048575);
  return (
    <div className="space-y-2 rounded-xl border border-pv-border p-2">
      <p className="text-[12px] font-semibold text-pv-text">Customer traffic</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <Pill onClick={() => c.act({ type: "ping", to: "H66" })} disabled={c.busy} tone="primary">
          ping H66 (low-latency app)
        </Pill>
        <Pill onClick={() => c.act({ type: "ping", to: "H6" })} disabled={c.busy}>
          ping H6 (default)
        </Pill>
      </div>
      <p className="text-[12px] font-semibold text-pv-text">A label probe from R1 (to 10.0.0.6)</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <input aria-label="Label stack" className="w-36 rounded border border-pv-border bg-pv-bg px-1.5 py-0.5 pv-mono text-[12px] text-pv-text" value={list} onChange={(e) => setList(e.target.value)} />
        <Pill onClick={() => c.act({ type: "probe", stack })} disabled={c.busy || !okList}>
          send
        </Pill>
        <span className="text-[11.5px] text-pv-text-faint">outermost first · 16006 = R6 algo 0 · 16106 = R6 algo 128</span>
      </div>
      {!c.s.ticket && (
        <div className="flex flex-wrap items-center gap-2">
          <Pill onClick={() => c.act({ type: "wipe-r6" })} disabled={c.busy || !!c.s.wiped} tone="danger">
            Wipe R6&apos;s Flex-Algo
          </Pill>
          <span className="text-[11.5px] text-pv-text-faint">for challenge 5: rebuild it from R6&apos;s console</span>
        </div>
      )}
    </div>
  );
}

const SPEC: SpLabSpec<FaState, FaAction, FaSnap> = {
  title: "SR Flex-Algo Lab",
  note: () => "six routers · IS-IS SR-MPLS · Flex-Algo 128 · IOS XR",
  fresh: (seq) => createFaNet(seq),
  vendors: ["cisco"],
  apply: faApply,
  snapOf: (s) => ({ view: s.view }),
  ticketAction: (id) => ({ type: "ticket", id: id as FaTicketId }),
  levels: FA_LEVELS,
  gate: {
    title: "You can run a second topology with Flex-Algo",
    points: [
      "Algorithm 0 is the ordinary IGP: one metric, every link, every router.",
      "A Flex-Algo Definition (metric type, affinity rules) is advertised in IS-IS; the highest priority wins.",
      "Participating routers each compute the algorithm's topology — non-participants and excluded links are cut out.",
      "Each router advertises a prefix SID per algorithm; the label says which topology to follow.",
      "Traffic is steered onto an algorithm by its SID — here through policy LOW-LATENCY with sid-algorithm 128.",
    ],
    more: "The engineering workspace gives you R1–R6 in their own windows (Flex-Algo participation and definition, interface metric, delay and affinity, an IOS XR console with commit), pings with latency, label probes, five challenges and five tickets.",
  },
  stage,
  footer: (c) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
      <span>
        FAD 128: <b className="pv-mono text-pv-text">{c.live.view.fad[128] ? `${c.live.view.fad[128].src} · ${c.live.view.fad[128].def.mt}${c.live.view.fad[128].def.excl.length ? ` · excl ${c.live.view.fad[128].def.excl.join("+")}` : ""}` : "none"}</b> · LOW-LATENCY: <b className="pv-mono text-pv-text">{c.live.view.pol.up ? `up [${c.live.view.pol.labels.join(", ")}]` : "down"}</b>
      </span>
      <span className="text-pv-text-faint">links: metric · delay · affinity · violet path: algorithm 128</span>
    </div>
  ),
  devices: FA_ROUTERS,
  device: (id) => ({ label: id, icon: role(id), tone: "#22d3ee", sub: `${FA_LO[id as FaR]} · IOS XR` }),
  openFrom: 1,
  window: (id, c) => <RouterUI c={c} r={id as FaR} />,
  tools: [
    { id: "fad", label: "Definitions", render: (c) => <Fad c={c} /> },
    { id: "paths", label: "Paths per algorithm", render: (c) => <Paths c={c} /> },
    { id: "labels", label: "Labels", render: (c) => <Labels c={c} /> },
    { id: "links", label: "Link attributes", render: (c) => <Links c={c} /> },
    { id: "path", label: "Last test, hop by hop", render: (c) => <PathView c={c} /> },
    { id: "log", label: "Log", render: (c) => <LogTool c={c} /> },
  ],
  toolsLabel: { learn: "What the routers know", eng: "Tools" },
  evidence,
  composer: (c) => <Composer c={c} />,
  investigate: [
    "On R1: show isis flex-algo 128. Who advertises the definition, and what does it say?",
    "On R1: show isis database verbose R6.00-00. Find R6's two prefix SIDs and the delays it advertises.",
    "On R1: show mpls forwarding. Where do 16006 and 16106 go — and why is there no 16102?",
    "On R1: show segment-routing traffic-eng policy, then show cef 192.168.66.0/24.",
    "Raise R3–R5's advertised delay to 80000 µs on both ends. What happens to H66 — and why nothing, until the BLUE exclusion goes?",
  ],
  challenges: FA_CHALLENGES,
  tickets: FA_TICKETS.map((t) => ({ id: t.id, title: t.title, report: t.report, reproLabel: t.reproLabel, repro: t.repro })),
  ticketIntro: "Users report latency, not causes. Each ticket is this network after a change with one real thing wrong. Reproduce it, walk the evidence (the label R1 pushes, the policy, the winning definition, participation, prefix SIDs, link attributes), name the cause, fix it on the router and prove it with a fresh ping.",
  reproHint: "Watch which label R1 pushes for H66 and which path it takes.",
  fixHint: "Fix it on the router (its window or its console — commit to apply), check show isis flex-algo 128 and the labels, then ping H66 again. The policy being up isn't proof — the latency is.",
  causes: FA_CAUSES,
  feedback: faCauseFeedback,
  proofs: faProofs,
  ladder: (s) => faLadder(s),
  text: (v, t) => spText(v, t),
  runCard: (c) => (
    <Card title="Result">
      <TestView c={c} />
    </Card>
  ),
};

export function FaLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SpLabWorkspace spec={SPEC} open={open} onClose={onClose} />;
}
