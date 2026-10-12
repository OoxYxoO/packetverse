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
  SP_CAUSES,
  SP_HOSTS,
  SP_LINKS,
  SP_LO,
  SP_ROUTERS,
  SP_TICKETS,
  createSrpNet,
  goldPol,
  isActive,
  segText,
  spIfs,
  srpApply,
  srpCauseFeedback,
  srpLadder,
  srpProofs,
  steering,
  type Aff,
  type IfName,
  type SpAction,
  type SpHost,
  type SpR,
  type SpRtr,
  type SpSnap,
  type SpState,
  type SpTicketId,
} from "@/lib/sim-engine/scenarios/srpNet";
import { srpSets, type SrpCliApi } from "./srpCli";
import { SRP_LEVELS } from "./srpLearn";
import { SRP_CHALLENGES } from "./srpPractice";

/**
 * SR Policy Lab — R1 steers the GOLD application into SR policy GOLD (color 100, end-point R6) on IOS XR.
 *   LEARN                  6 levels (srpLearn): from segments to intent · candidate paths · steering by color · a
 *                          candidate fails · no valid candidate · when it breaks
 *   ENGINEERING WORKSPACE  Investigate (pings to the GOLD and the default server, link failures, label stacks from R1,
 *                          router windows with the SR-TE state and an IOS XR console) · Challenges (five) ·
 *                          Troubleshoot (five tickets)
 * One model (srpNet.ts) produces every policy, candidate path, segment list, label and verdict.
 */

type Ctx = SpCtx<SpState, SpAction, SpSnap>;
type Node = SpR | SpHost;
const POS: Record<Node, { x: number; y: number; cx: number; cy: number }> = {
  H1: { x: 5, y: 50, cx: 5, cy: 36 },
  R1: { x: 20, y: 50, cx: 20, cy: 36 },
  R2: { x: 42, y: 20, cx: 42, cy: 6 },
  R4: { x: 66, y: 20, cx: 66, cy: 6 },
  R3: { x: 42, y: 82, cx: 42, cy: 96 },
  R5: { x: 66, y: 82, cx: 66, cy: 96 },
  R6: { x: 82, y: 50, cx: 82, cy: 36 },
  H6: { x: 96, y: 30, cx: 96, cy: 16 },
  H60: { x: 96, y: 70, cx: 96, cy: 84 },
};
const role = (d: string) => (d.startsWith("H") ? "CE" : d === "R1" || d === "R6" ? "PE" : "P");

function stage(c: Ctx, p: { moment?: SpMoment<SpSnap>; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) {
  const s = c.s;
  const v = c.live.view;
  const nodes: SpStageNode[] = (Object.keys(POS) as Node[]).map((d) => ({ id: d, label: d, role: role(d), tone: d === "H6" ? "#fbbf24" : d.startsWith("H") ? "#34d399" : "#22d3ee", sub: d.startsWith("H") ? SP_HOSTS[d as SpHost].ip.replace("192.168.", "…") : SP_LO[d as SpR], ...POS[d] }));
  const links: SpStageLink[] = [
    { id: "H1-R1", a: "H1", b: "R1", state: "up", label: "LAN" },
    { id: "R6-H6", a: "R6", b: "H6", state: "up", label: "GOLD" },
    { id: "R6-H60", a: "R6", b: "H60", state: "up", label: "default" },
    ...SP_LINKS.map((l) => {
      const f = s.cfg[l.a].ifs[l.ai]!;
      return { id: l.id, a: l.a, b: l.b, state: (v.adj[l.id] ? "up" : "blocked") as SpStageLink["state"], label: v.adj[l.id] ? `${f.metric} ${f.aff.join("+")}` : "down" };
    }),
  ];
  const g = goldPol(c.s);
  const views: Record<string, TopoView> = { R1: { badge: { text: g ? (g.up ? `GOLD up · ${g.active!.cand.kind} ${g.active!.cand.pref}` : "GOLD down") : "no policy", tone: g?.up ? "info" : "warn" } } };
  for (const r of SP_ROUTERS) if (!s.cfg[r].sr) views[r] = { badge: { text: "no SR", tone: "warn" } };
  const paths: SpPath[] = [];
  const last = s.tests[s.tests.length - 1];
  if (last && !p.moment && last.cfgSeq === s.cfgSeq) paths.push({ id: "t", nodes: last.path.filter((x, i, a) => a.indexOf(x) === i), color: last.ok ? (last.steered ? "#fbbf24" : "#34d399") : "#f87171", offset: 0 });
  return <SpStage nodes={nodes} links={links} paths={paths} views={views} moment={p.moment} momentKey={p.momentKey} compact={p.compact} onNode={p.onNode} selected={p.selected} regions={[{ x: 13, y: 5, w: 76, h: 90, label: "IS-IS + SR-MPLS · R1 is the SR-TE headend", color: "#22d3ee" }]} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------------------------
type Cell = string | [string, "ok" | "bad"];
function Pol({ c }: { c: Ctx }) {
  const g = goldPol(c.s);
  if (!g) return <p className="text-[12px] text-pv-text-faint">No policy GOLD on R1.</p>;
  return (
    <div className="grid gap-x-4 sm:grid-cols-2">
      <Kv k="Policy" v={`${g.pol.name} · color ${g.pol.color ?? "none"} · end-point ${g.pol.endpoint ?? "none"}`} />
      <Kv k="State" v={g.up ? "up" : `down — ${g.why}`} tone={g.up ? undefined : "warn"} />
      <Kv k="Binding SID" v={g.up && g.pol.bsid !== undefined ? String(g.pol.bsid) : "none"} />
      <Kv k="Active candidate" v={g.active ? `preference ${g.active.cand.pref} (${g.active.cand.kind}) → [${g.active.labels.join(", ")}]` : "none"} tone={g.active ? undefined : "warn"} />
    </div>
  );
}
function Cands({ c }: { c: Ctx }) {
  const g = goldPol(c.s);
  const rows = (g?.cands ?? []).map((k) => [String(k.cand.pref), k.cand.kind === "explicit" ? `explicit · ${k.cand.list}` : `dynamic · ${k.cand.metric ?? "te"} · include-any ${k.cand.include?.join(", ") || "—"}`, k.valid ? ["valid", "ok"] : [`invalid: ${k.why}`, "bad"], k.labels.length ? k.labels.join(", ") : "—", k.path ? k.path.join(" → ") : "—", isActive(g, k) ? ["ACTIVE", "ok"] : ""] as Cell[]);
  return <STable cols={["Preference", "Candidate", "Validity", "Segment list", "Computed path", ""]} rows={rows} empty="No candidate paths." />;
}
function Steer({ c }: { c: Ctx }) {
  const rows = (["H6", "H60"] as SpHost[]).map((h) => {
    const st = steering(c.s.cfg, c.live.view, h);
    return [`${SP_HOSTS[h].net}/24`, st.colored ? "color 100" : "none", SP_LO.R6, st.pol?.up ? [`policy ${st.pol.pol.name}`, "ok"] : "Node SID 16006", st.why] as Cell[];
  });
  return <STable cols={["BGP route (on R1)", "Color", "Next hop", "Forwarded by", "Why"]} rows={rows} />;
}
function Fwd({ c, only }: { c: Ctx; only?: SpR }) {
  const v = c.live.view;
  const rows = SP_ROUTERS.filter((r) => !only || r === only).flatMap((r) => v.table[r].filter((e) => !e.own).map((e) => [r, String(e.label), e.kind === "bsid" ? `BSID of ${e.policy}` : e.kind === "adj" ? `Adj-SID → ${e.to}` : `Node SID ${e.to}`, e.kind === "bsid" ? `→ [${e.list!.join(", ")}]` : e.out === "Pop" ? "pop" : e.out === "Unlabelled" ? ["Unlabelled", "bad"] : `swap → ${e.out}`, e.nh ? `${e.nh.nh} (${ifName(c.vendor, e.nh.ifn)})` : "—"] as Cell[]));
  return <STable cols={["Router", "In label", "Segment", "Action", "Out to"]} rows={rows} empty="No label programmed." />;
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
        {t.kind === "ping" ? `ping ${t.dst} from H1` : `R1 → 10.0.0.6 with [${t.stack?.join(", ")}]`}: <span className={t.ok ? "text-pv-success" : "text-pv-danger"}>{t.ok ? "success" : "failed"}</span>
        <span className="ml-2 text-[11.5px] font-normal text-pv-text-muted">
          path {t.path.join(" → ")}
          {t.kind === "ping" && (t.steered ? ` · steered into ${t.steered}` : " · not steered")}
        </span>
      </p>
      {t.why && <p className="text-[11.5px] text-pv-warning">{t.why}</p>}
    </div>
  );
}
function Ladder({ c }: { c: Ctx }) {
  if (c.busy) return <p className="text-[12px] text-pv-text-faint">The ladder fills in when the run has finished.</p>;
  return (
    <ol className="space-y-1">
      {srpLadder(c.s).map((r, i) => (
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
    case "pol":
      return card("SR policy GOLD on R1", <Pol c={c} />);
    case "cands":
      return card("Candidate paths", <Cands c={c} />);
    case "steer":
      return card("Steering: which BGP routes use the policy", <Steer c={c} />);
    case "fwd":
      return card("Label tables", <Fwd c={c} />);
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
function cfgDiff(a: SpRtr, b: SpRtr): string {
  const out: string[] = [];
  if (a.sr !== b.sr) out.push(`segment routing ${b.sr ? "on" : "off"}`);
  if (a.sid !== b.sid) out.push(b.sid !== undefined ? `Prefix-SID index ${b.sid}` : "Prefix-SID removed");
  if (a.colorOut !== b.colorOut) out.push(b.colorOut ? "route-policy SET-COLOR out applied" : "route-policy SET-COLOR out removed");
  for (const k of new Set([...Object.keys(a.ifs), ...Object.keys(b.ifs)]) as Set<IfName>) {
    const x = a.ifs[k]!;
    const y = b.ifs[k]!;
    if (x.isis !== y.isis) out.push(`${k} IS-IS ${y.isis ? "on" : "off"}`);
    if (x.metric !== y.metric) out.push(`${k} metric ${y.metric}`);
    if (x.aff.join() !== y.aff.join()) out.push(`${k} affinity ${y.aff.join("+") || "none"}`);
  }
  if (JSON.stringify(a.lists) !== JSON.stringify(b.lists)) out.push("segment lists changed");
  if (JSON.stringify(a.policies) !== JSON.stringify(b.policies)) out.push("SR policy changed");
  return out.join(", ") || "no change";
}
function devCli(c: Ctx, r: SpR): SpDevCli<SpRtr> {
  return {
    host: r,
    running: c.s.cfg[r],
    hist: c.s.hist[r],
    cand: c.cli.cand[r] as SpRtr | undefined,
    setCand: (x) => c.cli.setCand(r, x),
    xr: c.cli.xr[r] ?? [],
    setXr: (st) => c.cli.setXr(r, st),
    edit: !!c.cli.edit[r],
    setEdit: (b) => c.cli.setEdit(r, b),
    commit: (cfg, how) => c.act({ type: "cfg", dev: r, cfg, text: `${cfgDiff(c.s.cfg[r], cfg)} (${how}, IOS XR)` }),
    ask: c.cli.setQuestion,
  };
}
type Tab = "te" | "ifs" | "term" | "log";
function RouterUI({ c, r }: { c: Ctx; r: SpR }) {
  const [tab, setTab] = useState<Tab>(r === "R1" ? "te" : "ifs");
  const s = c.s;
  const cfg = s.cfg[r];
  const v = c.live.view;
  const change = (f: (x: SpRtr) => void) => {
    const n = spClone(cfg);
    f(n);
    c.act({ type: "cfg", dev: r, cfg: n, text: `${cfgDiff(cfg, n)} (from ${r}'s window)` });
  };
  const api: SrpCliApi = { s, act: c.act, dev: devCli(c, r) };
  const tabs: [Tab, string][] = [...(r === "R1" ? ([["te", "SR-TE"]] as [Tab, string][]) : []), ["ifs", "Interfaces"], ["term", "Console"], ["log", "Log"]];
  return (
    <div>
      <Tabs tabs={tabs} cur={tab} set={setTab} />
      <div className="space-y-2 p-3">
        {tab === "te" && r === "R1" && (
          <>
            <Pol c={c} />
            <Cands c={c} />
            <Card title="Segment lists">
              {Object.entries(cfg.lists).map(([n, segs]) => (
                <p key={n} className="pv-mono text-[11.5px] text-pv-text-muted">
                  {n}: {[...segs].sort((a, b) => a.idx - b.idx).map((x) => `${x.idx} ${segText(x)}`).join(" · ")}
                </p>
              ))}
            </Card>
            <Steer c={c} />
            <p className="text-[11.5px] text-pv-text-faint">Policies and segment lists are configured in the Console (candidate + commit).</p>
          </>
        )}
        {tab === "ifs" && (
          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-max text-left text-[12px]">
              <thead className="text-pv-text-faint">
                <tr>
                  {["Interface", "To", "IS-IS", "Metric", "BLUE", "GOLD", "Adjacency"].map((h) => (
                    <th key={h} className="px-1">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {spIfs(r).map((i) => {
                  const f = cfg.ifs[i.ifn]!;
                  const tog = (a: Aff, on: boolean) => change((x) => void (x.ifs[i.ifn]!.aff = on ? [...new Set([...x.ifs[i.ifn]!.aff, a])] : x.ifs[i.ifn]!.aff.filter((y) => y !== a)));
                  return (
                    <tr key={i.ifn} className="border-t border-pv-border/40">
                      <td className="px-1 py-0.5 pv-mono text-pv-text">{ifName("cisco", i.ifn)}</td>
                      <td className="px-1 text-pv-text-muted">{i.peer}</td>
                      <td className="px-1">
                        <input type="checkbox" aria-label={`isis ${i.ifn}`} checked={f.isis} disabled={c.busy} onChange={(e) => change((x) => void (x.ifs[i.ifn]!.isis = e.target.checked))} />
                      </td>
                      <td className="px-1">
                        <select aria-label={`metric ${i.ifn}`} className="rounded border border-pv-border bg-pv-bg px-1 text-[12px] text-pv-text" value={f.metric} disabled={c.busy} onChange={(e) => change((x) => void (x.ifs[i.ifn]!.metric = +e.target.value))}>
                          {[...new Set([10, 15, 20, 30, 50, 100, f.metric])].sort((a, b) => a - b).map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </td>
                      {(["BLUE", "GOLD"] as Aff[]).map((a) => (
                        <td key={a} className="px-1">
                          <input type="checkbox" aria-label={`${a} ${i.ifn}`} checked={f.aff.includes(a)} disabled={c.busy} onChange={(e) => tog(a, e.target.checked)} />
                        </td>
                      ))}
                      <td className={clsx("px-1", v.adj[i.link.id] ? "text-pv-success" : "text-pv-danger")}>{v.adj[i.link.id] ? "Up" : "none"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Fwd c={c} only={r} />
          </div>
        )}
        {tab === "term" && <SpConsole c={c.cli} sets={srpSets(api, r)} os="iosxr" host={r} vendor="cisco" setVendor={c.setVendor} />}
        {tab === "log" && (
          <ul className="space-y-0.5">
            {s.sys.filter((x) => x.dev === r).slice(-30).reverse().map((x, i) => (
              <li key={i} className="pv-mono text-[11.5px] text-pv-text-muted">
                {spStamp(x.t).hms} {x.kind === "commit" ? "configuration committed" : x.kind === "policy-up" ? `SR policy ${x.peer} up` : x.kind === "policy-down" ? `SR policy ${x.peer} down` : x.kind === "cand-change" ? `SR policy ${x.peer}: active candidate changed` : `IS-IS ${x.peer} ${x.kind === "adj-up" ? "Up" : "Down"}`}
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
  const [list, setList] = useState("30001");
  const stack = list.split(/[\s,]+/).filter(Boolean).map(Number);
  const okList = stack.length > 0 && stack.length <= 6 && stack.every((x) => Number.isInteger(x) && x >= 16 && x <= 1048575);
  return (
    <div className="space-y-2 rounded-xl border border-pv-border p-2">
      <p className="text-[12px] font-semibold text-pv-text">Customer traffic from H1</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <Pill onClick={() => c.act({ type: "ping", to: "H6" })} disabled={c.busy} tone="primary">
          ping H6 (GOLD)
        </Pill>
        <Pill onClick={() => c.act({ type: "ping", to: "H60" })} disabled={c.busy}>
          ping H60 (default)
        </Pill>
      </div>
      <p className="text-[12px] font-semibold text-pv-text">Link failures</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        {["R3-R5", "R3-R4", "R1-R3"].map((id) => {
          const up = c.s.view.adj[id];
          return (
            <Pill key={id} onClick={() => c.act({ type: "link", id, up: !up })} disabled={c.busy} tone={up ? "danger" : undefined}>
              {up ? `fail ${id}` : `restore ${id}`}
            </Pill>
          );
        })}
      </div>
      <p className="text-[12px] font-semibold text-pv-text">A label stack from R1</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <input aria-label="Label stack" className="w-48 rounded border border-pv-border bg-pv-bg px-1.5 py-0.5 pv-mono text-[12px] text-pv-text" value={list} onChange={(e) => setList(e.target.value)} />
        <Pill onClick={() => c.act({ type: "probe", stack })} disabled={c.busy || !okList}>
          send
        </Pill>
        <span className="text-[11.5px] text-pv-text-faint">outermost first · 30001 = the BSID</span>
      </div>
    </div>
  );
}

const SPEC: SpLabSpec<SpState, SpAction, SpSnap> = {
  title: "SR Policy Lab",
  note: () => "one headend · one policy · two candidate paths · steering by color",
  fresh: (seq) => createSrpNet(seq),
  vendors: ["cisco"],
  apply: srpApply,
  snapOf: (s) => ({ view: s.view }),
  ticketAction: (id) => ({ type: "ticket", id: id as SpTicketId }),
  levels: SRP_LEVELS,
  gate: {
    title: "You can read an SR policy end to end",
    points: [
      "An SR policy is identified by (color, end-point) on its headend; the binding SID is a local label that stands for it.",
      "Candidate paths: explicit (a segment list) or dynamic (computed with constraints such as affinity). The valid one with the highest preference is active.",
      "Address-based explicit lists are validated hop by hop; label-based lists only by their first SID.",
      "BGP routes carrying the policy's color, with its end-point as next hop, are steered into it.",
      "No valid candidate: the policy is down and steered routes fall back to their ordinary path (the IOS XR default).",
    ],
    more: "The engineering workspace gives you R1–R6 in their own windows (R1's SR-TE state, every router's interfaces with metrics and affinities, an IOS XR console with commit), pings to the GOLD and the default server, link failures, label stacks from R1, five challenges and five tickets.",
  },
  stage,
  footer: (c) => {
    const g = goldPol(c.s);
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
        <span>
          Policy GOLD: <b className="pv-mono text-pv-text">{g?.up ? `up · preference ${g.active!.cand.pref} ${g.active!.cand.kind}` : "down"}</b> · links down {SP_LINKS.filter((l) => !c.live.view.adj[l.id]).length}
        </span>
        <span className="text-pv-text-faint">link labels: metric + affinities · amber path = steered into the policy</span>
      </div>
    );
  },
  devices: SP_ROUTERS,
  device: (id) => ({ label: id, icon: role(id), tone: "#22d3ee", sub: `${SP_LO[id as SpR]} · IOS XR${id === "R1" ? " · headend" : ""}` }),
  openFrom: 1,
  window: (id, c) => <RouterUI c={c} r={id as SpR} />,
  tools: [
    { id: "pol", label: "Policy", render: (c) => <Pol c={c} /> },
    { id: "cands", label: "Candidate paths", render: (c) => <Cands c={c} /> },
    { id: "steer", label: "Steering", render: (c) => <Steer c={c} /> },
    { id: "fwd", label: "Label tables", render: (c) => <Fwd c={c} /> },
    { id: "path", label: "Last test, hop by hop", render: (c) => <PathView c={c} /> },
    { id: "log", label: "Log", render: (c) => <LogTool c={c} /> },
  ],
  toolsLabel: { learn: "What the routers know", eng: "Tools" },
  evidence,
  composer: (c) => <Composer c={c} />,
  investigate: [
    "On R1: show segment-routing traffic-eng policy. Which candidate is active, and why is the other one waiting?",
    "On R1: show bgp ipv4 unicast 192.168.6.0/24 and 192.168.60.0/24. Which carries a color, and what does the policy add to it?",
    "On R1: show cef 192.168.6.0/24. Which labels leave R1 — and why isn't 16003 among them?",
    "Fail R3–R5 and read the policy again. Which candidate is active now, and what is its segment list?",
    "Send [30001] from R1. What did R1 do with the binding SID?",
  ],
  challenges: SRP_CHALLENGES,
  tickets: SP_TICKETS.map((t) => ({ id: t.id, title: t.title, report: t.report, reproLabel: t.reproLabel, repro: t.repro })),
  ticketIntro: "Customers report symptoms, not causes. Each ticket is this network after a change with one real thing wrong. Reproduce it, walk the evidence (IS-IS and SR, the policy, its candidates, the steering, the labels of the active list), name the cause, fix it on the router and prove it with a fresh ping.",
  reproHint: "Watch whether the GOLD ping is steered into the policy — and which segment list it carries.",
  fixHint: "Fix it on the router (its console — commit to apply), read the policy and the BGP route, then ping again. A policy that is up proves nothing about where the traffic goes.",
  causes: SP_CAUSES,
  feedback: srpCauseFeedback,
  proofs: srpProofs,
  ladder: (s) => srpLadder(s),
  runCard: (c) => (
    <Card title="Result">
      <TestView c={c} />
    </Card>
  ),
};

export function SrpLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SpLabWorkspace spec={SPEC} open={open} onClose={onClose} />;
}
