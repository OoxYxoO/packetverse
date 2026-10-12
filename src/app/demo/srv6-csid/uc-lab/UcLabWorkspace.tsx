"use client";

import { useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { SpLabWorkspace, type SpCtx, type SpLabSpec } from "@/components/sp-lab/SpLabWorkspace";
import { SpStage, type SpPath, type SpStageLink, type SpStageNode } from "@/components/sp-lab/SpStage";
import { SpConsole } from "@/components/sp-lab/SpDesk";
import { Card, Kv, Pill, STable, Tabs } from "@/components/sp-lab/SpUi";
import { spClone, spStamp, type SpMoment } from "@/components/sp-lab/spKit";
import type { SpDevCli } from "@/components/sp-lab/spCli";
import { spText } from "@/components/sp-lab/spNames";
import type { TopoView } from "@/components/presentation/Visuals";
import {
  CAP,
  LIST,
  MTU6,
  U_CAUSES,
  U_LINKS,
  U_LO,
  U_ROUTERS,
  U_TICKETS,
  createUNet,
  hx,
  locOf,
  uApply,
  uCauseFeedback,
  uLadder,
  uProofs,
  type UAction,
  type UR,
  type URtr,
  type USnap,
  type UState,
  type UTicketId,
} from "@/lib/sim-engine/scenarios/ucNet";
import { ucSets, type UcCliApi } from "./ucCli";
import { UC_LEVELS } from "./ucLearn";
import { UC_CHALLENGES } from "./ucPractice";

/**
 * SRv6 uSID Lab — the guided lesson's eight-router chain on IOS XR with uSID (F3216) locators: R1 packs policy GREEN's
 * segment list into 128-bit carriers, every router shifts its uSID, R6 crosses into the next carrier, R8's uDT4 delivers.
 *   LEARN                  6 levels (ucLearn)
 *   ENGINEERING WORKSPACE  Investigate (pings of 100 or 1430 bytes; the classic-vs-compressed comparison; router
 *                          windows with locators, SIDs, R1's segment-list editor and IOS XR consoles) · Challenges
 *                          (five) · Troubleshoot (five tickets)
 * One model (ucNet.ts) produces every SID, carrier, shift, byte count and result.
 */

type Ctx = SpCtx<UState, UAction, USnap>;
type Node = UR | "CE1" | "CE8";
const POS: Record<Node, { x: number; y: number; cx: number; cy: number }> = {
  CE1: { x: 4, y: 62, cx: 4, cy: 49 },
  R1: { x: 14, y: 62, cx: 14, cy: 49 },
  R2: { x: 24, y: 62, cx: 24, cy: 75 },
  R3: { x: 35, y: 62, cx: 35, cy: 75 },
  R4: { x: 45, y: 26, cx: 45, cy: 13 },
  R5: { x: 56, y: 62, cx: 56, cy: 75 },
  R6: { x: 66, y: 62, cx: 66, cy: 75 },
  R7: { x: 77, y: 26, cx: 77, cy: 13 },
  R8: { x: 87, y: 62, cx: 87, cy: 75 },
  CE8: { x: 97, y: 62, cx: 97, cy: 49 },
};
const short = (x: string) => x.replace("fcbb:bb00:", "…:");

function lastWalk(c: Ctx) {
  return c.s.tests[c.s.tests.length - 1]?.walk;
}
function stage(c: Ctx, p: { moment?: SpMoment<USnap>; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) {
  const s = c.s;
  const v = c.live.view;
  const nodes: SpStageNode[] = (Object.keys(POS) as Node[]).map((d) => ({ id: d, label: d, role: d.startsWith("CE") ? "CE" : d === "R1" || d === "R8" ? "PE" : "P", tone: d.startsWith("CE") ? "#34d399" : s.cfg[d as UR]?.micro === false ? "#fbbf24" : "#22d3ee", sub: d.startsWith("CE") ? (d === "CE1" ? "10.1.1.0/24" : "10.8.1.0/24") : `uSID ${hx(+d.slice(1))}${s.cfg[d as UR].micro ? "" : " (classic)"}`, ...POS[d] }));
  const links: SpStageLink[] = [
    { id: "CE1-R1", a: "CE1", b: "R1", state: "up" },
    { id: "R8-CE8", a: "R8", b: "CE8", state: "up" },
    ...U_LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b, state: "up" as SpStageLink["state"], label: l.id === "R6-R8" ? "express 1 ms" : l.id === "R3-R5" ? "alt 3 ms" : "" })),
  ];
  const views: Record<string, TopoView> = { R1: { badge: { text: `${v.green.entries.length} entr${v.green.entries.length > 1 ? "ies" : "y"} · ${v.green.overhead} B`, tone: v.green.overhead + 1430 > MTU6 ? "warn" : "info" } } };
  const paths: SpPath[] = [];
  const w = lastWalk(c);
  if (!p.moment && w && s.tests.at(-1)!.cfgSeq === s.cfgSeq) paths.push({ id: "w", nodes: w.path, color: w.ok ? "#a78bfa" : "#f87171", offset: 0 });
  return <SpStage nodes={nodes} links={links} paths={paths} views={views} moment={p.moment} momentKey={p.momentKey} compact={p.compact} onNode={p.onNode} selected={p.selected} regions={[{ x: 10, y: 6, w: 82, h: 86, label: "uSID block fcbb:bb00::/32 · F3216", color: "#22d3ee" }]} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------------------------
type Cell = string | [string, "ok" | "bad" | "warn"];
function Compare({ c }: { c: Ctx }) {
  const g = c.live.view.green;
  const row = (name: string, n: number, srh: number, ovh: number): Cell[] => [name, String(n), n > 1 ? `8 + 16 × ${n - 1} = ${srh}` : "none", `40 + ${srh} = ${ovh}`, ovh + 1430 <= MTU6 ? [`${ovh + 1430} ✓`, "ok"] : [`${ovh + 1430} ✗`, "bad"]];
  return (
    <div className="space-y-1">
      <p className="text-[11.5px] text-pv-text-muted">
        The SID list R1 is sending: {g.sids.map(short).join(", ")} ({g.sids.length} SIDs). First entry in the DA, the rest in the SRH (reduced encapsulation). Core IPv6 MTU {MTU6}.
      </p>
      <STable cols={["Encoding", "128-bit entries", "SRH bytes", "Overhead bytes", "1430-byte packet"]} rows={[row("Classic (one SID per entry)", g.classicEntries, g.classicSrhBytes, g.classicOverhead), row(c.s.cfg.R1.fmt ? "What R1 pushes (uSID carriers)" : "What R1 pushes (no uSID format)", g.entries.length, g.srhBytes, g.overhead)]} />
      <p className="text-[11.5px] text-pv-text-muted">Saved: {g.classicOverhead - g.overhead} bytes per packet.</p>
    </div>
  );
}
function Carriers({ c }: { c: Ctx }) {
  const g = c.live.view.green;
  const rows = g.entries.map((e, i) => [i === 0 ? "DA" : `SRH [${g.entries.length - 1 - i}]`, e.text, e.classic ? ["classic SID — 1 per entry", "warn"] : `${e.usids.map(hx).join(" ")} (${e.usids.length}/${CAP})`, e.sids.map(short).join(", ")] as Cell[]);
  return <STable cols={["Position", "128-bit value", "uSIDs", "SIDs packed"]} rows={rows} />;
}
function Hops({ c }: { c: Ctx }) {
  const w = lastWalk(c);
  if (!w) return <p className="text-[12px] text-pv-text-faint">Ping above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The packet appears when the run has finished.</p>;
  const rows = w.hops.filter((h) => h.da || h.kind === "drop" || h.kind === "deliver").map((h) => [h.to && h.at !== h.to ? `${h.at} → ${h.to}` : `at ${h.at}`, h.da ?? "—", h.active ?? "—", h.sl === undefined ? "—" : String(h.sl), h.kind === "shift" ? ["shift", "ok"] : h.kind === "next" ? ["next carrier", "warn"] : h.kind === "drop" ? ["dropped", "bad"] : h.kind] as Cell[]);
  return <STable cols={["Where", "Destination address", "Active uSID", "SL", "What happened"]} rows={rows} />;
}
function Sids({ c, only }: { c: Ctx; only?: UR }) {
  const v = c.live.view;
  const rows = U_ROUTERS.filter((r) => (only ? r === only : true)).flatMap((r) => v.sids[r].map((x) => [r, x.sid, x.behavior, x.micro ? x.usids!.map(hx).join(" ") : ["128-bit, no uSID", "warn"], x.peer ? `→ ${x.peer}` : x.behavior.includes("DT4") ? "VRF CUST" : x.behavior.includes("B6") ? "policy GREEN" : "this node"] as Cell[]));
  return <STable cols={["Router", "SID", "Behavior", "uSIDs", "Context"]} rows={rows} />;
}
function PathView({ c }: { c: Ctx }) {
  const run = [...c.s.runs].reverse().find((r) => r.kind === "test");
  if (!run) return <p className="text-[12px] text-pv-text-faint">Ping above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The walk appears when the run has finished.</p>;
  return (
    <ol className="space-y-0.5">
      {run.moments.map((m, i) => (
        <li key={i} className={clsx("text-[12px]", m.lines[0]?.tone === "warn" || m.lines[0]?.tone === "bad" ? "text-pv-warning" : m.lines[0]?.tone === "ok" ? "text-pv-success" : m.lines[0]?.tone === "learn" ? "text-pv-text" : "text-pv-text-muted")}>
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
        CE1 → CE8, {t.size} bytes: <span className={t.walk.ok ? "text-pv-success" : "text-pv-danger"}>{t.walk.ok ? `delivered, ${t.walk.ms} ms` : "failed"}</span>
      </p>
      <p className="text-[11.5px] text-pv-text-muted">
        path {t.walk.path.join(" → ")} · {t.entries} entr{t.entries > 1 ? "ies" : "y"}, {t.overhead} B overhead, {t.walk.bytes} B on the wire
      </p>
      {t.walk.why && <p className="text-[11.5px] text-pv-warning">{t.walk.why}</p>}
    </div>
  );
}
function Ladder({ c }: { c: Ctx }) {
  if (c.busy) return <p className="text-[12px] text-pv-text-faint">The ladder fills in when the run has finished.</p>;
  return (
    <ol className="space-y-1">
      {uLadder(c.s).map((r, i) => (
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
    case "compare":
      return card("Classic vs compressed, computed from what R1 pushes", <Compare c={c} />);
    case "carriers":
      return card("The entries R1 pushes", <Carriers c={c} />);
    case "hops":
      return card("The packet, router by router", <Hops c={c} />);
    case "sids":
      return card("Local SID tables", <Sids c={c} />);
    case "path":
      return card("What each router did", <PathView c={c} />);
    case "test":
      return card("What the ping did", <TestView c={c} />);
    case "ladder":
      return card("The evidence ladder, read from the network", <Ladder c={c} />);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Router windows
// ---------------------------------------------------------------------------------------------------------------
function cfgDiff(a: URtr, b: URtr): string {
  const out: string[] = [];
  if (a.micro !== b.micro) out.push(`locator MAIN ${b.micro ? "micro-segment (uSID)" : "classic"}`);
  if (a.isisLoc !== b.isisLoc) out.push(`locator ${b.isisLoc ? "advertised" : "withdrawn"} in IS-IS`);
  if (a.fmt !== b.fmt) out.push(`sid-format ${b.fmt ? "usid-f3216" : "removed"}`);
  if (JSON.stringify(a.lists) !== JSON.stringify(b.lists)) out.push(`${LIST}: ${[...(b.lists?.[LIST] ?? [])].sort((x, y) => x.idx - y.idx).map((e) => short(e.sid)).join(", ") || "empty"}`);
  if (JSON.stringify(a.xfn) !== JSON.stringify(b.xfn)) out.push("uA functions re-allocated");
  return out.join(", ") || "no change";
}
function devCli(c: Ctx, r: UR): SpDevCli<URtr> {
  return {
    host: r,
    running: c.s.cfg[r],
    hist: c.s.hist[r],
    cand: c.cli.cand[r] as URtr | undefined,
    setCand: (x) => c.cli.setCand(r, x),
    xr: c.cli.xr[r] ?? [],
    setXr: (st) => c.cli.setXr(r, st),
    edit: !!c.cli.edit[r],
    setEdit: (b) => c.cli.setEdit(r, b),
    commit: (cfg, how) => c.act({ type: "cfg", dev: r, cfg, text: `${cfgDiff(c.s.cfg[r], cfg)} (${how}, IOS XR)` }),
    ask: c.cli.setQuestion,
  };
}
function ListEditor({ c, change }: { c: Ctx; change: (f: (x: URtr) => void) => void }) {
  const list = [...(c.s.cfg.R1.lists?.[LIST] ?? [])].sort((a, b) => a.idx - b.idx);
  const all = U_ROUTERS.filter((r) => r !== "R1").flatMap((r) => c.live.view.sids[r].filter((x) => !x.behavior.includes("DT4") && !x.behavior.includes("B6")).map((x) => ({ sid: x.sid, label: `${x.sid} — ${r} ${x.behavior}${x.peer ? ` → ${x.peer}` : ""}` })));
  const [add, setAdd] = useState(all[0]?.sid ?? "");
  const sel = "rounded border border-pv-border bg-pv-bg px-1 py-0.5 text-[12px] text-pv-text";
  return (
    <Card title={`Segment list ${LIST} (policy GREEN)`}>
      <ol className="space-y-1">
        {list.map((e, k) => (
          <li key={e.idx} className="flex flex-wrap items-center gap-1.5 text-[12px]">
            <span className="pv-mono text-pv-text-faint">index {e.idx}</span>
            <span className="pv-mono text-pv-text">{e.sid}</span>
            <Pill onClick={() => k > 0 && change((x) => { const l = [...x.lists![LIST]].sort((a, b) => a.idx - b.idx); const t = l[k].sid; l[k].sid = l[k - 1].sid; l[k - 1].sid = t; x.lists![LIST] = l; })} disabled={c.busy || k === 0}>
              ↑
            </Pill>
            <Pill onClick={() => change((x) => void (x.lists![LIST] = x.lists![LIST].filter((y) => y.idx !== e.idx)))} disabled={c.busy} tone="danger">
              remove
            </Pill>
          </li>
        ))}
        {!list.length && <li className="text-[12px] text-pv-text-faint">(empty)</li>}
      </ol>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px]">
        <select aria-label="SID to add" className={clsx(sel, "max-w-full")} value={add} onChange={(e) => setAdd(e.target.value)}>
          {all.map((x) => (
            <option key={x.sid} value={x.sid}>
              {x.label}
            </option>
          ))}
        </select>
        <Pill onClick={() => change((x) => { const l = x.lists![LIST]; l.push({ idx: (l.reduce((m, y) => Math.max(m, y.idx), 0) || 0) + 10, sid: add }); })} disabled={c.busy || !add} tone="primary">
          append
        </Pill>
      </div>
      <p className="mt-1 text-[11px] text-pv-text-faint">R8&apos;s uDT4 service SID is added after the list automatically (from BGP).</p>
    </Card>
  );
}
type Tab = "main" | "list" | "sids" | "term" | "log";
function RouterUI({ c, r }: { c: Ctx; r: UR }) {
  const [tab, setTab] = useState<Tab>("main");
  const s = c.s;
  const cfg = s.cfg[r];
  const change = (f: (x: URtr) => void) => {
    const n = spClone(cfg);
    f(n);
    c.act({ type: "cfg", dev: r, cfg: n, text: `${cfgDiff(cfg, n)} (from ${r}'s window)` });
  };
  const api: UcCliApi = { s, act: c.act, dev: devCli(c, r) };
  const tabs: [Tab, string][] = r === "R1" ? [["main", "Policy & carriers"], ["list", "Segment list"], ["sids", "SIDs"], ["term", "Console"], ["log", "Log"]] : [["main", "Locator"], ["sids", "SIDs"], ["term", "Console"], ["log", "Log"]];
  return (
    <div>
      <Tabs tabs={tabs} cur={tab} set={setTab} />
      <div className="space-y-2 p-3">
        {tab === "main" && (
          <>
            <Card title={`${r} · ${U_LO(r)} · locator MAIN ${locOf(r)}/48`}>
              <div className="grid gap-x-4 sm:grid-cols-2">
                <Kv k="Micro-segment (uSID) locator" v={cfg.micro ? "yes — uN, uA, uDT" : "no — classic SIDs"} tone={cfg.micro ? undefined : "warn"} />
                <Kv k="Locator advertised in IS-IS" v={cfg.isisLoc ? "yes" : "no"} tone={cfg.isisLoc ? undefined : "warn"} />
                {r === "R1" && <Kv k="Segment-list SID format" v={cfg.fmt ? "usid-f3216 (packs)" : "none (classic)"} tone={cfg.fmt ? undefined : "warn"} />}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Pill onClick={() => change((x) => void (x.micro = !x.micro))} disabled={c.busy}>
                  {cfg.micro ? "make classic" : "make micro-segment"}
                </Pill>
                {r === "R1" && (
                  <Pill onClick={() => change((x) => void (x.fmt = !x.fmt))} disabled={c.busy}>
                    {cfg.fmt ? "remove sid-format" : "set sid-format usid-f3216"}
                  </Pill>
                )}
              </div>
            </Card>
            {r === "R1" && (
              <>
                <Carriers c={c} />
                <Compare c={c} />
              </>
            )}
          </>
        )}
        {tab === "list" && r === "R1" && <ListEditor c={c} change={change} />}
        {tab === "sids" && <Sids c={c} only={r} />}
        {tab === "term" && <SpConsole c={c.cli} sets={ucSets(api, r)} os="iosxr" host={r} vendor={c.vendor} setVendor={c.setVendor} />}
        {tab === "log" && (
          <ul className="space-y-0.5">
            {s.sys.filter((x) => x.dev === r).slice(-30).reverse().map((x, i) => (
              <li key={i} className="pv-mono text-[11.5px] text-pv-text-muted">
                {spStamp(x.t).hms} {x.kind === "commit" ? "configuration committed" : x.kind === "policy" ? "policy GREEN changed state" : `IS-IS ${x.peer} Up`}
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
  return (
    <div className="space-y-2 rounded-xl border border-pv-border p-2">
      <p className="text-[12px] font-semibold text-pv-text">CUST traffic, site 1 → site 8 (policy GREEN)</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <Pill onClick={() => c.act({ type: "ping", size: 100 })} disabled={c.busy} tone="primary">
          ping 100 bytes
        </Pill>
        <Pill onClick={() => c.act({ type: "ping", size: 1430 })} disabled={c.busy}>
          ping 1430 bytes
        </Pill>
        <Pill onClick={() => c.act({ type: "wipe-list" })} disabled={c.busy || !(c.s.cfg.R1.lists?.[LIST] ?? []).length} tone="danger">
          Empty PATH-A
        </Pill>
      </div>
      <p className="text-[11.5px] text-pv-text-faint">Edit PATH-A in R1&apos;s window (Segment list) or console; each router&apos;s Locator tab switches micro-segment on or off.</p>
    </div>
  );
}

const SPEC: SpLabSpec<UState, UAction, USnap> = {
  title: "SRv6 uSID Lab",
  note: () => "compressed SRv6 · F3216 · IOS XR",
  fresh: (seq) => createUNet(seq),
  vendors: ["cisco"],
  apply: uApply,
  snapOf: (s) => ({ view: s.view }),
  ticketAction: (id) => ({ type: "ticket", id: id as UTicketId }),
  levels: UC_LEVELS,
  gate: {
    title: "You can operate compressed SRv6",
    points: [
      "uSIDs share one block (fcbb:bb00::/32); a 128-bit carrier holds the block once and up to six 16-bit uSIDs.",
      "The active uSID is bits 32–47 of the destination; its owner executes it and shifts the rest left.",
      "Segments Left changes only when a carrier runs out and the next SRH entry is copied in.",
      "Global uSIDs (nodes) are routed on /48 locators; local uSIDs (e000–efff) only mean something at their node.",
      "Compression changes the encoding, never the path: a node that can't be compressed costs a whole 128-bit entry.",
    ],
    more: "The engineering workspace gives you every router in its own window (locator mode, SIDs, R1's segment-list editor and carriers, IOS XR consoles with commit), pings of 100 or 1430 bytes against a 1500-byte MTU, the classic-vs-compressed comparison, five challenges and five tickets.",
  },
  stage,
  footer: (c) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
      <span>
        R1 pushes: <b className="pv-mono text-pv-text">{c.live.view.green.entries.map((e) => short(e.text)).join(" | ")}</b> · overhead <b className="text-pv-text">{c.live.view.green.overhead} B</b> (classic {c.live.view.green.classicOverhead} B)
      </span>
      <span className="text-pv-text-faint">amber node: classic locator</span>
    </div>
  ),
  devices: U_ROUTERS,
  device: (id) => ({ label: id, icon: id === "R1" || id === "R8" ? "PE" : "P", tone: "#22d3ee", sub: `${locOf(id as UR)}/48 · IOS XR` }),
  openFrom: 1,
  window: (id, c) => <RouterUI c={c} r={id as UR} />,
  tools: [
    { id: "compare", label: "Classic vs compressed", render: (c) => <Compare c={c} /> },
    { id: "carriers", label: "Carriers R1 pushes", render: (c) => <Carriers c={c} /> },
    { id: "hops", label: "Packet, router by router", render: (c) => <Hops c={c} /> },
    { id: "sids", label: "Local SIDs", render: (c) => <Sids c={c} /> },
    { id: "path", label: "Last ping, step by step", render: (c) => <PathView c={c} /> },
    { id: "log", label: "Log", render: (c) => <LogTool c={c} /> },
  ],
  toolsLabel: { learn: "What the routers know", eng: "Tools" },
  evidence,
  composer: (c) => <Composer c={c} />,
  investigate: [
    "On R1: show segment-routing traffic-eng policy — how many SIDs, how many carriers?",
    "On R1: show cef vrf CUST 10.8.1.10 — what exactly is pushed, and how many bytes of overhead?",
    "Ping 100 bytes and follow the active uSID router by router. Where does Segments Left change?",
    "On R6: show segment-routing srv6 sid. Which of its SIDs are two uSIDs long, and why?",
    "Switch R1's sid-format off and compare the overhead with a 1430-byte ping.",
  ],
  challenges: UC_CHALLENGES,
  tickets: U_TICKETS.map((t) => ({ id: t.id, title: t.title, report: t.report, reproLabel: t.reproLabel, repro: t.repro })),
  ticketIntro: "Customers report symptoms — big packets failing, latency, drops at one router. Each ticket is this network after a change with one real thing wrong. Reproduce it, climb the ladder (policy, locators, packing, uSID order, local uSIDs), name the cause, fix it, and prove it with fresh traffic.",
  reproHint: "Watch the number of entries R1 pushes, the overhead and where the packet stops.",
  fixHint: "Fix it on the router (its window or console — commit to apply), check what R1 pushes, then ping again.",
  causes: U_CAUSES,
  feedback: uCauseFeedback,
  proofs: uProofs,
  ladder: (s) => uLadder(s),
  text: (v, t) => spText(v, t),
  runCard: (c) => (
    <Card title="Result">
      <TestView c={c} />
    </Card>
  ),
};

export function UcLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SpLabWorkspace spec={SPEC} open={open} onClose={onClose} />;
}
