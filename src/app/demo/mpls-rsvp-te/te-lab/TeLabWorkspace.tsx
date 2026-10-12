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
  AFF_NAMES,
  CE_NET,
  IMPLICIT_NULL,
  LINK_MBPS,
  TE_CAUSES,
  TE_LINKS,
  TE_LO,
  TE_ROUTERS,
  TE_TICKETS,
  autorouted,
  createTeNet,
  custBFlow,
  dirKey,
  ifsOf,
  igpPaths,
  linkLoads,
  linkUp,
  lspLabel,
  routeTo,
  teApply,
  teCauseFeedback,
  teLadder,
  teProofs,
  tedDirs,
  unreserved,
  type IfName,
  type TeAction,
  type TeCe,
  type TeCfg,
  type TeR,
  type TeSnap,
  type TeState,
  type TeTicketId,
  type TeView,
} from "@/lib/sim-engine/scenarios/teNet";
import { tePipe, teSets, type TeCliApi } from "./teCli";
import { TE_LEVELS } from "./teLearn";
import { TE_CHALLENGES } from "./tePractice";

/**
 * RSVP-TE Lab — the guided lesson's six routers with real traffic, on the shared Service Provider lab workspace.
 *   LEARN                  6 levels (teLearn): why TE · the TED and CSPF · PATH and RESV · into the tunnel ·
 *                          constraints and priorities · reading the evidence
 *   ENGINEERING WORKSPACE  Investigate (traffic flows, link cuts; router windows with interfaces, tunnels, the TED and an
 *                          IOS XR / Junos console) · Challenges (five) · Troubleshoot (five tickets)
 * One model (teNet.ts) produces every TED entry, CSPF result, PATH / RESV, label, reservation and flow verdict.
 */

type Ctx = SpCtx<TeState, TeAction, TeSnap>;
type Node = TeR | TeCe;
const POS: Record<Node, { x: number; y: number; cx: number; cy: number }> = {
  CE1: { x: 5, y: 50, cx: 8, cy: 92 },
  R1: { x: 18, y: 50, cx: 14, cy: 50 },
  R2: { x: 40, y: 18, cx: 38, cy: 16 },
  R4: { x: 66, y: 18, cx: 64, cy: 16 },
  R3: { x: 40, y: 82, cx: 38, cy: 84 },
  R5: { x: 66, y: 82, cx: 64, cy: 84 },
  R6: { x: 84, y: 50, cx: 88, cy: 50 },
  CE6: { x: 96, y: 50, cx: 92, cy: 92 },
};
const TONE = { R: "#22d3ee", CE: "#fbbf24" };
const LSP_COLORS = ["#a78bfa", "#fbbf24", "#34d399", "#f472b6", "#60a5fa"];
const mb = (kbps: number) => `${Math.round(kbps / 1000)}`;

function stage(c: Ctx, p: { moment?: SpMoment<TeSnap>; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) {
  const s = c.s;
  const v: TeView = c.live.view;
  const nodes: SpStageNode[] = (Object.keys(POS) as Node[]).map((d) => ({ id: d, label: d, role: d.startsWith("CE") ? "CE" : d === "R1" || d === "R6" ? "PE" : "P", tone: d.startsWith("CE") ? TONE.CE : TONE.R, sub: d.startsWith("CE") ? CE_NET[d as TeCe].net.replace("/24", "") : TE_LO[d as TeR], ...POS[d] }));
  const dirs = tedDirs(s.cfg);
  const links: SpStageLink[] = [
    { id: "CE1-R1", a: "CE1", b: "R1", state: "dim" },
    { id: "R6-CE6", a: "R6", b: "CE6", state: "dim" },
    ...TE_LINKS.map((l) => {
      const ab = dirs.find((d) => d.from === l.a && d.to === l.b)!;
      const ba = dirs.find((d) => d.from === l.b && d.to === l.a)!;
      const up = linkUp(s.cfg, l);
      const teOk = ab.inTed && ba.inTed;
      const free = Math.min(unreserved(ab, v.resv, 7), unreserved(ba, v.resv, 7));
      return { id: l.id, a: l.a, b: l.b, state: (!up ? "down" : !teOk ? "blocked" : "up") as SpStageLink["state"], label: !up ? "down" : !teOk ? "not in TED" : `${mb(free)}/${mb(Math.min(ab.maxRes, ba.maxRes))} free` };
    }),
  ];
  const views: Record<string, TopoView> = {};
  for (const r of TE_ROUTERS) {
    const heads = v.lsps.filter((l) => l.head === r);
    if (!heads.length) continue;
    const down = heads.filter((l) => l.state !== "up");
    views[r] = { badge: { text: down.length ? `${down.length} LSP down` : `${heads.length} LSP up`, tone: down.length ? "bad" : "yes" } };
  }
  const paths: SpPath[] = [];
  v.lsps.forEach((l, i) => {
    if (l.state === "up" && l.path) paths.push({ id: l.key, nodes: l.path, color: LSP_COLORS[i % LSP_COLORS.length], label: l.head === "R1" ? lspLabel(s.os, l) : undefined, offset: (i % 2 ? -1 : 1) * 1.6, dashed: l.head !== "R1" });
  });
  const last = s.tests[s.tests.length - 1];
  if (last && !p.moment && last.cfgSeq === s.cfgSeq) paths.push({ id: "t", nodes: last.path, color: last.ok ? "#34d399" : "#f87171", offset: 0 });
  return <SpStage nodes={nodes} links={links} paths={paths} views={views} moment={p.moment} momentKey={p.momentKey} compact={p.compact} onNode={p.onNode} selected={p.selected} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------------------------
function Loads({ c }: { c: Ctx }) {
  const loads = linkLoads(c.s.cfg, c.live.view, custBFlow(c.s));
  const last = c.s.tests[c.s.tests.length - 1];
  const rows = TE_LINKS.flatMap((l) =>
    [
      [l.a, l.b],
      [l.b, l.a],
    ].map(([a, b]) => {
      const k = dirKey(a as TeR, b as TeR);
      const withFlow = last && last.cfgSeq === c.s.cfgSeq && last.path.some((x, i) => i > 0 && last.path[i - 1] === a && x === b) ? last.mbps : 0;
      const tot = loads[k] + withFlow;
      return [`${a}→${b}`, linkUp(c.s.cfg, l) ? loads[k] : "down", withFlow ? `+${withFlow}` : "", [`${tot} / ${LINK_MBPS}`, tot > LINK_MBPS ? "bad" : tot > 900 ? "warn" : "ok"]] as (string | number | [string, "ok" | "bad" | "warn"])[];
    }),
  );
  return <STable cols={["Direction", "Other traffic (Mbps)", "Last flow", "Total / capacity"]} rows={rows} />;
}
function Ted({ c }: { c: Ctx }) {
  const rows = tedDirs(c.s.cfg).map((d) => [`${d.from}→${d.to}`, d.inTed ? ["yes", "ok"] : [d.up ? "no" : "link down", "bad"], d.teMetric, mb(d.maxRes), mb(unreserved(d, c.live.view.resv, 7)), d.attr.join(" ") || "—"] as (string | number | [string, "ok" | "bad"])[]);
  return <STable cols={["Direction", "In TED", "TE metric", "Reservable (Mbps)", "Unreserved @7", "Colors"]} rows={rows} />;
}
function Lsps({ c }: { c: Ctx }) {
  const rows = c.live.view.lsps.map((l) => {
    const t = c.s.cfg[l.head].tunnels.find((x) => x.id === l.id)!;
    return [`${l.head} ${lspLabel(c.s.os, l)}`, t.dst || "—", `${mb(t.bw)}${l.resizeFailed ? ` (holds ${mb(l.bw)})` : ""}`, `${t.setup}/${t.hold}`, [l.state, l.state === "up" ? (l.resizeFailed ? "warn" : "ok") : "bad"], l.state === "up" ? l.path!.join("→") : l.why ?? ""] as (string | [string, "ok" | "bad" | "warn"])[];
  });
  return <STable cols={["LSP", "To", "Mbps", "Prio", "State", "Path / why"]} rows={rows} empty="No LSPs are configured." />;
}
function Resv({ c }: { c: Ctx }) {
  const rows = c.live.view.resv.map((x) => {
    const l = c.live.view.lsps.find((y) => y.key === x.lsp)!;
    return [x.key.replace(">", "→"), lspLabel(c.s.os, l), mb(x.bw), x.hold];
  });
  return <STable cols={["Direction", "Held by", "Mbps", "Hold prio"]} rows={rows} empty="Nothing is reserved." />;
}
function Labels({ c }: { c: Ctx }) {
  const rows = c.live.view.lsps.filter((l) => l.state === "up").flatMap((l) =>
    l.path!.map((r, i) => {
      const inL = l.labels[r];
      const nx = l.path![i + 1];
      const outL = nx ? l.labels[nx] : undefined;
      const action = i === 0 ? `push ${outL === IMPLICIT_NULL ? "—" : outL}` : !nx ? "IP lookup (tail)" : outL === IMPLICIT_NULL ? `pop ${inL} (PHP)` : `swap ${inL} → ${outL}`;
      return [lspLabel(c.s.os, l), r, i === 0 ? "—" : inL === IMPLICIT_NULL ? "implicit-null" : String(inL), action];
    }),
  );
  return <STable cols={["LSP", "Router", "Label it asked for", "What it does"]} rows={rows} empty="No LSP is up." />;
}
function RouteView({ c }: { c: Ctx }) {
  const rt = routeTo(c.s.cfg, c.live.view, "R1", "R6");
  return (
    <div className="space-y-1 text-[12.5px]">
      <Kv k="R1 → 10.6.6.0/24" v={rt ? (rt.via === "tunnel" ? `${lspLabel(c.s.os, rt.tunnel!)} (${c.s.os === "xr" ? "autoroute announce" : "IS-IS shortcuts"})` : `IS-IS via ${rt.path[1]}`) : "no route"} tone={rt?.via === "tunnel" ? "ok" : "warn"} />
      <Kv k="IS-IS shortest path R1 → R6" v={igpPaths(c.s.cfg, "R1").R6?.path.join("→") ?? "—"} />
    </div>
  );
}
function TestView({ c }: { c: Ctx }) {
  const t = c.s.tests[c.s.tests.length - 1];
  if (!t) return <p className="text-[12px] text-pv-text-faint">Run the test above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The result appears when the run has finished.</p>;
  return (
    <div className={clsx("rounded-lg border px-2 py-1 text-[12.5px]", t.ok ? "border-pv-success/40" : "border-pv-danger/40")}>
      <p className="font-semibold text-pv-text">
        {t.mbps} Mbps {t.from} → {t.to}: <span className={t.ok ? "text-pv-success" : "text-pv-danger"}>{t.ok ? "delivered" : `${t.lossPct}% dropped`}</span>
      </p>
      <p className="pv-mono text-[11.5px] text-pv-text-muted">
        path: {t.path.join(" → ")} · via {t.via}
      </p>
      {t.why && <p className="text-[11.5px] text-pv-warning">{t.why}</p>}
    </div>
  );
}
function Ladder({ c }: { c: Ctx }) {
  if (c.busy) return <p className="text-[12px] text-pv-text-faint">The ladder fills in when the run has finished.</p>;
  return (
    <ol className="space-y-1">
      {teLadder(c.s).map((r, i) => (
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
    case "loads":
      return card("Traffic on every link direction", <Loads c={c} />);
    case "ted":
      return card("The TED (what every router knows about TE links)", <Ted c={c} />);
    case "lsps":
      return card("LSPs", <Lsps c={c} />);
    case "resv":
      return card("RSVP reservations", <Resv c={c} />);
    case "labels":
      return card("Labels along each LSP", <Labels c={c} />);
    case "route":
      return card("How R1 routes the video", <RouteView c={c} />);
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
function cfgDiff(a: TeCfg, b: TeCfg): string {
  const out: string[] = [];
  for (const k of Object.keys(b.ifs) as IfName[]) {
    const x = a.ifs[k];
    const y = b.ifs[k];
    if (x.shut !== y.shut) out.push(`${k} ${y.shut ? "shutdown" : "no shutdown"}`);
    if (x.te !== y.te) out.push(`${k} ${y.te ? "is a TE interface" : "no longer a TE interface"}`);
    if (x.rsvp !== y.rsvp) out.push(`${k} RSVP ${y.rsvp === undefined ? "removed" : `${mb(y.rsvp)} Mbps`}`);
    if (x.attr.join() !== y.attr.join()) out.push(`${k} colors ${y.attr.join(" ") || "none"}`);
    if (x.teMetric !== y.teMetric) out.push(`${k} TE metric ${y.teMetric ?? "default"}`);
  }
  for (const t of b.tunnels) {
    const o = a.tunnels.find((x) => x.id === t.id);
    if (!o) out.push(`${t.name} created`);
    else if (JSON.stringify(o) !== JSON.stringify(t)) out.push(`${t.name} changed`);
  }
  for (const t of a.tunnels) if (!b.tunnels.some((x) => x.id === t.id)) out.push(`${t.name} removed`);
  if (JSON.stringify(a.paths) !== JSON.stringify(b.paths)) out.push("explicit paths changed");
  if (!!a.shortcuts !== !!b.shortcuts) out.push(`IS-IS shortcuts ${b.shortcuts ? "on" : "off"}`);
  return out.join(", ") || "no change";
}
function devCli(c: Ctx, r: TeR): SpDevCli<TeCfg> {
  return {
    host: r,
    running: c.s.cfg[r],
    hist: c.s.hist[r],
    cand: c.cli.cand[r] as TeCfg | undefined,
    setCand: (x) => c.cli.setCand(r, x),
    xr: c.cli.xr[r] ?? [],
    setXr: (st) => c.cli.setXr(r, st),
    edit: !!c.cli.edit[r],
    setEdit: (b) => c.cli.setEdit(r, b),
    commit: (cfg, how) => c.act({ type: "cfg", dev: r, cfg, text: `${cfgDiff(c.s.cfg[r], cfg)} (${how}, ${c.vendor === "cisco" ? "IOS XR" : "Junos"})` }),
    ask: c.cli.setQuestion,
  };
}
function RouterUI({ c, r }: { c: Ctx; r: TeR }) {
  const [tab, setTab] = useState<"router" | "tunnels" | "ted" | "term" | "log">("router");
  const s = c.s;
  const cfg = s.cfg[r];
  const change = (f: (x: TeCfg) => void) => {
    const n = spClone(cfg);
    f(n);
    c.act({ type: "cfg", dev: r, cfg: n, text: `${cfgDiff(cfg, n)} (from ${r}'s window)` });
  };
  const api: TeCliApi = { s, act: c.act, dev: devCli(c, r) };
  const heads = c.live.view.lsps.filter((l) => l.head === r);
  return (
    <div>
      <Tabs tabs={[["router", "Interfaces"], ["tunnels", "Tunnels"], ["ted", "TED"], ["term", "Console"], ["log", "Log"]]} cur={tab} set={setTab} />
      <div className="space-y-2 p-3">
        {tab === "router" && (
          <>
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Kv k="TE router ID" v={TE_LO[r]} />
              <Kv k="IS-IS TE" v={cfg.isisTe ? "flooding TE links" : "off"} tone={cfg.isisTe ? undefined : "bad"} />
            </div>
            <div className="max-w-full overflow-x-auto">
              <table className="w-full min-w-max text-left text-[12px]">
                <thead className="text-pv-text-faint">
                  <tr>
                    {["Interface", "To", "Up", "TE link", "RSVP (Mbps)", "Reserved", "Colors", "TE metric"].map((h) => (
                      <th key={h} className="px-1">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ifsOf(r).map((x) => {
                    const ic = cfg.ifs[x.ifn];
                    const res = c.live.view.resv.filter((y) => y.key === dirKey(r, x.peer)).reduce((a, y) => a + y.bw, 0);
                    return (
                      <tr key={x.ifn} className="border-t border-pv-border/40">
                        <td className="px-1 py-0.5 pv-mono text-pv-text">{ifName(c.vendor, x.ifn)}</td>
                        <td className="px-1 text-pv-text-muted">{x.peer}</td>
                        <td className="px-1">
                          <input type="checkbox" aria-label={`up ${x.ifn}`} checked={!ic.shut} disabled={c.busy} onChange={(e) => change((y) => void (y.ifs[x.ifn].shut = !e.target.checked))} />
                        </td>
                        <td className="px-1">
                          <input type="checkbox" aria-label={`te ${x.ifn}`} checked={ic.te} disabled={c.busy} onChange={(e) => change((y) => void (y.ifs[x.ifn].te = e.target.checked))} />
                        </td>
                        <td className="px-1 pv-mono">{ic.rsvp === undefined ? "—" : mb(ic.rsvp)}</td>
                        <td className="px-1 pv-mono text-pv-text-muted">{mb(res)}</td>
                        <td className="px-1">
                          <select aria-label={`color ${x.ifn}`} className="rounded border border-pv-border bg-pv-bg px-1 text-[11.5px] text-pv-text" value={ic.attr[0] ?? ""} disabled={c.busy} onChange={(e) => change((y) => void (y.ifs[x.ifn].attr = e.target.value ? [e.target.value] : []))}>
                            <option value="">none</option>
                            {AFF_NAMES.map((a) => (
                              <option key={a}>{a}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-1 pv-mono text-pv-text-muted">{ic.teMetric ?? x.link.metric}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11.5px] text-pv-text-faint">Checkboxes and colors are committed at once. Tunnels, explicit paths, bandwidths and priorities are configured in the Console (candidate + commit).</p>
          </>
        )}
        {tab === "tunnels" && (
          <>
            {heads.length ? (
              heads.map((l) => {
                const t = cfg.tunnels.find((x) => x.id === l.id)!;
                return (
                  <Card key={l.key} title={`${lspLabel(s.os, l)} → ${t.dst || "?"}`} right={<span className={clsx("text-[11.5px] font-semibold", l.state === "up" ? "text-pv-success" : "text-pv-danger")}>{l.state}</span>}>
                    <Kv k="Bandwidth" v={`${mb(t.bw)} Mbps${l.resizeFailed ? ` requested · holds ${mb(l.bw)}` : ""}`} tone={l.resizeFailed ? "warn" : undefined} />
                    <Kv k="Priority (setup / hold)" v={`${t.setup} / ${t.hold}`} />
                    <Kv k="Path options" v={[...t.opts].sort((a, b) => a.idx - b.idx).map((o) => `${o.idx} ${o.kind === "dynamic" ? "dynamic" : `explicit ${o.path}`}`).join(" · ") || "none"} />
                    <Kv k="Affinity" v={[...t.include.map((x) => `include ${x}`), ...t.exclude.map((x) => `exclude ${x}`)].join(", ") || "—"} />
                    <Kv k="Routed into by IS-IS" v={autorouted(cfg, t) ? "yes" : "no"} tone={autorouted(cfg, t) ? "ok" : "warn"} />
                    <Kv k={l.state === "up" ? "Path" : "Why down"} v={l.state === "up" ? l.path!.join(" → ") : l.why ?? "—"} tone={l.state === "up" ? undefined : "bad"} />
                  </Card>
                );
              })
            ) : (
              <p className="text-[12px] text-pv-text-faint">{r} is not the headend of any tunnel.</p>
            )}
            <Labels c={c} />
          </>
        )}
        {tab === "ted" && <Ted c={c} />}
        {tab === "term" && <SpConsole c={c.cli} sets={teSets(api, r)} os={c.vendor === "cisco" ? "iosxr" : "junos"} host={r} vendor={c.vendor} setVendor={c.setVendor} pipeCtx={c.vendor === "juniper" ? tePipe(api, r) : undefined} />}
        {tab === "log" && (
          <ul className="space-y-0.5">
            {s.sys.filter((x) => x.dev === r).slice(-30).reverse().map((x, i) => (
              <li key={i} className="pv-mono text-[11.5px] text-pv-text-muted">
                {spStamp(x.t).hms} {x.kind === "commit" ? "configuration committed" : x.kind === "preempt" ? `${x.what} preempted by ${x.why}` : `${x.what} ${x.kind === "up" ? "up" : `down (${x.why})`}`}
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
  const [from, setFrom] = useState<TeCe>("CE1");
  const [mbps, setMbps] = useState(500);
  const [link, setLink] = useState("R5-R6");
  const sel = "rounded border border-pv-border bg-pv-bg px-1 py-0.5 text-[12px] text-pv-text";
  const l = TE_LINKS.find((x) => x.id === link)!;
  const up = linkUp(c.s.cfg, l);
  return (
    <div className="space-y-2 rounded-xl border border-pv-border p-2">
      <p className="text-[12px] font-semibold text-pv-text">Customer traffic</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <select aria-label="From" className={sel} value={from} onChange={(e) => setFrom(e.target.value as TeCe)}>
          <option value="CE1">CE1 → CE6</option>
          <option value="CE6">CE6 → CE1</option>
        </select>
        <select aria-label="Rate" className={sel} value={mbps} onChange={(e) => setMbps(+e.target.value)}>
          {[100, 150, 300, 500, 700].map((x) => (
            <option key={x} value={x}>
              {x} Mbps
            </option>
          ))}
        </select>
        <Pill onClick={() => c.act({ type: "test", from, mbps })} disabled={c.busy} tone="primary">
          send
        </Pill>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <select aria-label="Link" className={sel} value={link} onChange={(e) => setLink(e.target.value)}>
          {TE_LINKS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.a}–{x.b}
            </option>
          ))}
        </select>
        <Pill onClick={() => c.act({ type: "link", link, up: !up })} disabled={c.busy} tone={up ? "danger" : undefined}>
          {up ? "Cut the link" : "Restore the link"}
        </Pill>
        <Pill onClick={() => c.act({ type: "wipe-r1" })} disabled={c.busy || !!c.s.wiped} tone="danger">
          Wipe R1&apos;s tunnels
        </Pill>
        <span className="text-[11.5px] text-pv-text-faint">for challenge 5</span>
      </div>
    </div>
  );
}

const SPEC: SpLabSpec<TeState, TeAction, TeSnap> = {
  title: "RSVP-TE Lab",
  note: () => "R1 → R6 · 500 Mbps video · CUST-B on R3",
  fresh: (seq, vendor) => createTeNet(seq, vendor === "cisco" ? "xr" : "junos"),
  vendorAction: (v) => ({ type: "os", os: v === "cisco" ? "xr" : "junos" }),
  apply: teApply,
  snapOf: (s) => ({ view: s.view }),
  ticketAction: (id) => ({ type: "ticket", id: id as TeTicketId }),
  levels: TE_LEVELS,
  gate: {
    title: "You can engineer traffic with RSVP-TE",
    points: [
      "IS-IS picks the lowest metric and ignores load; RSVP-TE lets the headend choose a path that has room.",
      "IS-IS floods TE metric, reservable and unreserved bandwidth per priority and colors: every router has the same TED.",
      "CSPF prunes what can't carry the LSP (bandwidth, colors, strict hops, missing TE links), then runs SPF on TE metrics.",
      "PATH goes down the ERO, RESV comes back with labels and reserves bandwidth hop by hop; the tail asks for implicit-null.",
      "A tunnel carries nothing until autoroute announce / IS-IS shortcuts route traffic into it — and a reservation never adds capacity.",
    ],
    more: "The engineering workspace gives you R1–R6 in their own windows (interfaces with TE / RSVP / colors, tunnels, the TED and an IOS XR / Junos console with commit), traffic flows in both directions, link cuts, five challenges and five tickets.",
  },
  stage,
  footer: (c) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
      <span>
        LSPs up: <b className="pv-mono text-pv-text">{c.s.view.lsps.filter((l) => l.state === "up").length}</b> / {c.s.view.lsps.length}
      </span>
      <span className="text-pv-text-faint">link labels: unreserved / reservable Mbps (the tighter direction) · colored lines: LSPs</span>
    </div>
  ),
  devices: TE_ROUTERS,
  device: (id, c) => ({ label: id, icon: id === "R1" || id === "R6" ? "PE" : "P", tone: TONE.R, sub: `${TE_LO[id as TeR]} · ${c.vendor === "cisco" ? "IOS XR" : "Junos"} view` }),
  openFrom: 1,
  window: (id, c) => <RouterUI c={c} r={id as TeR} />,
  tools: [
    { id: "lsps", label: "LSPs", render: (c) => <Lsps c={c} /> },
    { id: "ted", label: "TED", render: (c) => <Ted c={c} /> },
    { id: "resv", label: "Reservations", render: (c) => <Resv c={c} /> },
    { id: "loads", label: "Link loads", render: (c) => <Loads c={c} /> },
    { id: "labels", label: "Labels", render: (c) => <Labels c={c} /> },
    { id: "log", label: "Log", render: (c) => <LogTool c={c} /> },
  ],
  toolsLabel: { learn: "What the routers know", eng: "Tools" },
  evidence,
  composer: (c) => <Composer c={c} />,
  investigate: [
    "On R1, compare show mpls traffic-eng tunnels 1 (IOS XR) with show mpls lsp extensive (Junos): the ERO, the labels, the bandwidth.",
    "Read the TED on any router: which link has the least unreserved bandwidth, and who holds it?",
    "Send 700 Mbps from CE1. Then resize tunnel-te1 to 700000 kbps — what does make-before-break do?",
    "Cut R5–R6 and watch tunnel-te1 move. Which path did CSPF pick, and why not the top?",
    "Remove autoroute announce on R1 and compare R1's route to 10.6.6.0/24 before and after.",
  ],
  challenges: TE_CHALLENGES,
  tickets: TE_TICKETS.map((t) => ({ id: t.id, title: t.title, report: t.report, reproLabel: t.reproLabel, repro: t.repro })),
  ticketIntro: "Users report symptoms, not causes. Each ticket is this network after a change with one real thing wrong. Reproduce it, walk the evidence (the LSP state, the TED, the reservations, the routing), name the cause, fix it on the router and prove it with a fresh flow.",
  reproHint: "Watch which way the flow goes and which link drops it.",
  fixHint: "Fix it on the router (its window, or its console — commit to apply), check the tunnel and the TED, then run the flow again. An accepted command isn't a repaired LSP.",
  causes: TE_CAUSES,
  feedback: teCauseFeedback,
  proofs: teProofs,
  ladder: (s) => teLadder(s),
  text: (v, t) => spText(v, t),
  runCard: (c) => (
    <Card title="Result">
      <TestView c={c} />
    </Card>
  ),
};

export function TeLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SpLabWorkspace spec={SPEC} open={open} onClose={onClose} />;
}
