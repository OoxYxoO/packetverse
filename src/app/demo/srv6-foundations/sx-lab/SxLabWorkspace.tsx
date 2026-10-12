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
  BIG,
  CORE_MTU,
  DEFAULT_MTU,
  DEFAULT_SIZE,
  SX_CAUSES,
  SX_HOSTS,
  SX_LINKS,
  SX_LO,
  SX_ROUTERS,
  SX_TICKETS,
  TO_R6,
  VIA_R3,
  advertisesLoc,
  createSxNet,
  endSid,
  locPrefix,
  sxApply,
  sxCauseFeedback,
  sxIfs,
  sxLadder,
  sxLookup,
  sxProofs,
  v6norm,
  type IfName,
  type SxAction,
  type SxR,
  type SxRtr,
  type SxSnap,
  type SxState,
  type SxTicketId,
} from "@/lib/sim-engine/scenarios/sxNet";
import { sxSets, type SxCliApi } from "./sxCli";
import { SX_LEVELS } from "./sxLearn";
import { SX_CHALLENGES } from "./sxPractice";

/**
 * SRv6 Foundations Lab — the guided lesson's hexagon, IS-IS for IPv6 with SRv6 locators and End / End.X SIDs on IOS XR.
 *   LEARN                  6 levels (sxLearn): addresses that are instructions · the underlay first · a segment list and
 *                          the SRH · End at work · same SID, another path · when it breaks
 *   ENGINEERING WORKSPACE  Investigate (plain IPv6, segment lists from R1 with packet sizes, router windows with locator,
 *                          SIDs, interfaces and an IOS XR console) · Challenges (five) · Troubleshoot (five tickets)
 * One model (sxNet.ts) produces every locator, SID, route, header and verdict.
 */

type Ctx = SpCtx<SxState, SxAction, SxSnap>;
type Node = SxR | "H1" | "H6";
const POS: Record<Node, { x: number; y: number; cx: number; cy: number }> = {
  H1: { x: 5, y: 50, cx: 5, cy: 36 },
  R1: { x: 18, y: 50, cx: 18, cy: 36 },
  R2: { x: 38, y: 18, cx: 38, cy: 5 },
  R3: { x: 64, y: 18, cx: 64, cy: 5 },
  R4: { x: 38, y: 82, cx: 38, cy: 95 },
  R5: { x: 64, y: 82, cx: 64, cy: 95 },
  R6: { x: 84, y: 50, cx: 84, cy: 36 },
  H6: { x: 96, y: 50, cx: 96, cy: 36 },
};
const role = (d: string) => (d.startsWith("H") ? "CE" : d === "R1" || d === "R6" ? "PE" : "P");
const short = (x: string) => x.replace("2001:db8:100:", "…:");

function stage(c: Ctx, p: { moment?: SpMoment<SxSnap>; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) {
  const s = c.s;
  const v = c.live.view;
  const nodes: SpStageNode[] = (Object.keys(POS) as Node[]).map((d) => ({ id: d, label: d, role: role(d), tone: d.startsWith("H") ? "#34d399" : "#22d3ee", sub: d.startsWith("H") ? SX_HOSTS[d as "H1" | "H6"].ip.replace("2001:db8:", "…") : `…:${s.cfg[d as SxR].loc?.toString(16) ?? "–"}::/64`, ...POS[d] }));
  const links: SpStageLink[] = [
    { id: "H1-R1", a: "H1", b: "R1", state: "up", label: "LAN" },
    { id: "R6-H6", a: "R6", b: "H6", state: "up", label: "LAN" },
    ...SX_LINKS.map((l) => {
      const fa = s.cfg[l.a].ifs[l.ai]!;
      const fb = s.cfg[l.b].ifs[l.bi]!;
      const small = Math.min(fa.mtu, fb.mtu) < 9000;
      return { id: l.id, a: l.a, b: l.b, state: (v.adj[l.id] ? "up" : "blocked") as SpStageLink["state"], label: v.adj[l.id] ? `${fa.metric === fb.metric ? fa.metric : `${fa.metric}/${fb.metric}`}${small ? " · mtu 1514" : ""}` : "no IS-IS" };
    }),
  ];
  const views: Record<string, TopoView> = {};
  for (const r of SX_ROUTERS) {
    const e = v.sids[r].find((x) => x.behavior === "End");
    views[r] = { badge: { text: e ? `End ${short(e.sid)}` : s.cfg[r].lo1 ? "no SID (lo1)" : "no SID", tone: e ? "info" : "warn" } };
  }
  const paths: SpPath[] = [];
  const t = s.tests[s.tests.length - 1];
  if (!p.moment && t && t.cfgSeq === s.cfgSeq) paths.push({ id: "t", nodes: t.path, color: !t.ok ? "#f87171" : t.srh ? "#a78bfa" : t.kind === "srv6" ? "#22d3ee" : "#34d399", offset: 0 });
  return <SpStage nodes={nodes} links={links} paths={paths} views={views} moment={p.moment} momentKey={p.momentKey} compact={p.compact} onNode={p.onNode} selected={p.selected} regions={[{ x: 11, y: 4, w: 80, h: 92, label: "IS-IS IPv6 + SRv6", color: "#22d3ee" }]} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------------------------
type Cell = string | [string, "ok" | "bad" | "warn"];
function Sids({ c, only }: { c: Ctx; only?: SxR }) {
  const v = c.live.view;
  const rows = SX_ROUTERS.filter((r) => !only || r === only).flatMap((r) => (v.sids[r].length ? v.sids[r].map((x) => [r, x.sid, x.behavior, x.ifn ? `out ${ifName(c.vendor, x.ifn)} to ${x.peer}` : "this node"] as Cell[]) : [[r, ["none", "bad"], "—", c.s.cfg[r].sr6 ? (c.s.cfg[r].loc === undefined ? "no locator prefix" : !c.s.cfg[r].isisLoc ? "locator not enabled in IS-IS" : "—") : "SRv6 not enabled"] as Cell[]]));
  return <STable cols={["Router", "Local SID", "Behavior", "Means"]} rows={rows} />;
}
function Locs({ c }: { c: Ctx }) {
  const v = c.live.view;
  const rows = SX_ROUTERS.map((o) => {
    const pfx = c.s.cfg[o].loc !== undefined ? `${locPrefix(c.s.cfg[o].loc!)}/64` : "—";
    const rt = c.s.cfg[o].loc !== undefined ? sxLookup(v, "R1", endSid(c.s.cfg[o].loc!)) : undefined;
    return [o, pfx, advertisesLoc(c.s.cfg, o) ? ["advertised", "ok"] : c.s.cfg[o].lo1 ? ["only as a plain prefix (Loopback1)", "warn"] : ["not advertised", "bad"], o === "R1" ? "local" : rt?.nh ? `${rt.nh.nh} (cost ${rt.cost})` : ["no route", "bad"]] as Cell[];
  });
  return <STable cols={["Owner", "Locator", "In IS-IS", "R1's next hop"]} rows={rows} />;
}
function Headers({ c }: { c: Ctx }) {
  const t = [...c.s.tests].reverse().find((x) => x.kind === "srv6" || x.kind === "plain");
  if (!t) return <p className="text-[12px] text-pv-text-faint">Send traffic above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The headers appear when the run has finished.</p>;
  const rows = t.trace.map((h) => [h.from === h.to ? `at ${h.from}` : `${h.from} → ${h.to}`, h.outer ? short(h.da) : `inner → ${h.da}`, h.sl === undefined ? (h.outer ? "no SRH" : "—") : String(h.sl), h.list ? h.list.map((x, i) => `[${i}] ${short(x)}`).join(" ") : "—", `${h.bytes} B`] as Cell[]);
  return (
    <div className="space-y-1">
      <p className="text-[11.5px] text-pv-text-muted">{t.kind === "srv6" ? `segment list [${t.sids.map(short).join(", ")}] · ${t.size}-byte inner packet` : `plain IPv6 · ${t.size} bytes`}</p>
      <STable cols={["Where", "Destination address", "Segments Left", "SRH Segment List", "Size"]} rows={rows} />
    </div>
  );
}
function Mtu({ c }: { c: Ctx }) {
  const rows = SX_LINKS.map((l) => {
    const a = c.s.cfg[l.a].ifs[l.ai]!.mtu;
    const b = c.s.cfg[l.b].ifs[l.bi]!.mtu;
    return [`${l.a}–${l.b}`, a < 9000 ? [`${l.a} ${a}`, "warn"] : `${l.a} ${a}`, b < 9000 ? [`${l.b} ${b}`, "warn"] : `${l.b} ${b}`, `${Math.min(a, b) - 14} B`] as Cell[];
  });
  return <STable cols={["Link", "MTU", "MTU", "Largest IPv6 packet"]} rows={rows} />;
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
        {t.kind === "srv6" ? `H1 → H6 via [${t.sids.map(short).join(", ")}]` : t.kind === "plain" ? "H1 → H6 (plain IPv6)" : `ping ${t.dst} from ${t.from}`}: <span className={t.ok ? "text-pv-success" : "text-pv-danger"}>{t.ok ? "delivered" : "failed"}</span>
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
      {sxLadder(c.s).map((r, i) => (
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
    case "locs":
      return card("Locators and how R1 reaches them", <Locs c={c} />);
    case "headers":
      return card("The packet, hop by hop", <Headers c={c} />);
    case "mtu":
      return card("MTU per link", <Mtu c={c} />);
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
function cfgDiff(a: SxRtr, b: SxRtr): string {
  const out: string[] = [];
  if (a.sr6 !== b.sr6) out.push(`SRv6 ${b.sr6 ? "on" : "off"}`);
  if (a.loc !== b.loc) out.push(b.loc !== undefined ? `locator ${locPrefix(b.loc)}/64` : "locator removed");
  if (a.isisLoc !== b.isisLoc) out.push(`locator ${b.isisLoc ? "enabled" : "disabled"} in IS-IS`);
  if (a.encap !== b.encap) out.push(b.encap ? `encapsulation source ${b.encap}` : "encapsulation source removed");
  if (a.lo1 !== b.lo1) out.push(`Loopback1 ${b.lo1 ? "added" : "removed"}`);
  for (const k of Object.keys(b.ifs) as IfName[]) {
    const x = a.ifs[k]!;
    const y = b.ifs[k]!;
    if (x.isis !== y.isis) out.push(`${k} IS-IS ${y.isis ? "on" : "off"}`);
    if (x.metric !== y.metric) out.push(`${k} metric ${y.metric}`);
    if (x.mtu !== y.mtu) out.push(`${k} mtu ${y.mtu}`);
  }
  return out.join(", ") || "no change";
}
function devCli(c: Ctx, r: SxR): SpDevCli<SxRtr> {
  return {
    host: r,
    running: c.s.cfg[r],
    hist: c.s.hist[r],
    cand: c.cli.cand[r] as SxRtr | undefined,
    setCand: (x) => c.cli.setCand(r, x),
    xr: c.cli.xr[r] ?? [],
    setXr: (st) => c.cli.setXr(r, st),
    edit: !!c.cli.edit[r],
    setEdit: (b) => c.cli.setEdit(r, b),
    commit: (cfg, how) => c.act({ type: "cfg", dev: r, cfg, text: `${cfgDiff(c.s.cfg[r], cfg)} (${how}, IOS XR)` }),
    ask: c.cli.setQuestion,
  };
}
type Tab = "srv6" | "ifs" | "term" | "log";
function RouterUI({ c, r }: { c: Ctx; r: SxR }) {
  const [tab, setTab] = useState<Tab>("srv6");
  const s = c.s;
  const cfg = s.cfg[r];
  const v = c.live.view;
  const change = (f: (x: SxRtr) => void) => {
    const n = spClone(cfg);
    f(n);
    c.act({ type: "cfg", dev: r, cfg: n, text: `${cfgDiff(cfg, n)} (from ${r}'s window)` });
  };
  const api: SxCliApi = { s, act: c.act, dev: devCli(c, r) };
  return (
    <div>
      <Tabs tabs={[["srv6", "SRv6"], ["ifs", "Interfaces"], ["term", "Console"], ["log", "Log"]]} cur={tab} set={setTab} />
      <div className="space-y-2 p-3">
        {tab === "srv6" && (
          <>
            <Card title={`${r} · ${SX_LO(r)}`}>
              <div className="grid gap-x-4 sm:grid-cols-2">
                <Kv k="SRv6" v={cfg.sr6 ? "enabled" : "disabled"} tone={cfg.sr6 ? undefined : "warn"} />
                <Kv k="Locator MAIN" v={cfg.loc !== undefined ? `${locPrefix(cfg.loc)}/64` : "none"} tone={cfg.loc === SxIdx(r) ? undefined : "warn"} />
                <Kv k="Enabled in IS-IS" v={cfg.isisLoc ? "yes" : "no"} tone={cfg.isisLoc ? undefined : "warn"} />
                {r === "R1" && <Kv k="Encapsulation source" v={cfg.encap ?? "none"} tone={cfg.encap ? undefined : "warn"} />}
                {cfg.lo1 && <Kv k="Loopback1" v={`${locPrefix(SxIdx(r))}1/64 (plain prefix in IS-IS)`} tone="warn" />}
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-pv-text-muted">
                <label className="flex items-center gap-1">
                  <input type="checkbox" aria-label="isis locator" checked={cfg.isisLoc} disabled={c.busy} onChange={(e) => change((x) => void (x.isisLoc = e.target.checked))} /> segment-routing srv6 locator MAIN (IS-IS)
                </label>
              </div>
            </Card>
            <Sids c={c} only={r} />
            <p className="text-[11.5px] text-pv-text-faint">Locator prefix and encapsulation are configured in the Console (segment-routing srv6).</p>
          </>
        )}
        {tab === "ifs" && (
          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-max text-left text-[12px]">
              <thead className="text-pv-text-faint">
                <tr>
                  {["Interface", "To", "IPv6", "IS-IS", "Metric", "MTU", "Adjacency"].map((h) => (
                    <th key={h} className="px-1">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sxIfs(r).map((i) => {
                  const f = cfg.ifs[i.ifn]!;
                  return (
                    <tr key={i.ifn} className="border-t border-pv-border/40">
                      <td className="px-1 py-0.5 pv-mono text-pv-text">{ifName(c.vendor, i.ifn)}</td>
                      <td className="px-1 text-pv-text-muted">{i.peer}</td>
                      <td className="px-1 pv-mono text-pv-text-muted">{i.ip}</td>
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
                      <td className="px-1">
                        <select aria-label={`mtu ${i.ifn}`} className="rounded border border-pv-border bg-pv-bg px-1 text-[12px] text-pv-text" value={f.mtu} disabled={c.busy} onChange={(e) => change((x) => void (x.ifs[i.ifn]!.mtu = +e.target.value))}>
                          {[...new Set([DEFAULT_MTU, CORE_MTU, f.mtu])].sort((a, b) => a - b).map((m) => (
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
        {tab === "term" && <SpConsole c={c.cli} sets={sxSets(api, r)} os="iosxr" host={r} vendor={c.vendor} setVendor={c.setVendor} />}
        {tab === "log" && (
          <ul className="space-y-0.5">
            {s.sys.filter((x) => x.dev === r).slice(-30).reverse().map((x, i) => (
              <li key={i} className="pv-mono text-[11.5px] text-pv-text-muted">
                {spStamp(x.t).hms} {x.kind === "commit" ? "configuration committed" : x.kind === "sid" ? (x.peer ? `End SID ${x.peer} allocated` : "SRv6 locator withdrawn") : `IS-IS ${x.peer} ${x.kind === "adj-up" ? "Up" : "Down"}`}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
const SxIdx = (r: SxR) => SX_ROUTERS.indexOf(r) + 1;

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
const PRESETS: [string, string[]][] = [["R6", TO_R6], ["R3, R6", VIA_R3], ["R5, R3, R6", [endSid(5), endSid(3), endSid(6)]], ["R4, R5, R6", [endSid(4), endSid(5), endSid(6)]]];
function Composer({ c }: { c: Ctx }) {
  const [list, setList] = useState(VIA_R3.join(", "));
  const [size, setSize] = useState(DEFAULT_SIZE);
  const sids = list.split(/[\s,]+/).filter(Boolean);
  const okList = sids.length > 0 && sids.length <= 4 && sids.every((x) => !!v6norm(x));
  const sel = "rounded border border-pv-border bg-pv-bg px-1 py-0.5 text-[12px] text-pv-text";
  return (
    <div className="space-y-2 rounded-xl border border-pv-border p-2">
      <p className="text-[12px] font-semibold text-pv-text">Traffic from H1 to H6</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <select aria-label="Size" className={sel} value={size} onChange={(e) => setSize(+e.target.value)}>
          {[100, DEFAULT_SIZE, BIG].map((x) => (
            <option key={x} value={x}>
              {x} bytes
            </option>
          ))}
        </select>
        <Pill onClick={() => c.act({ type: "plain", size })} disabled={c.busy}>
          plain IPv6
        </Pill>
      </div>
      <p className="text-[12px] font-semibold text-pv-text">SRv6: R1 encapsulates with a segment list</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <input aria-label="Segment list" className="w-full max-w-md rounded border border-pv-border bg-pv-bg px-1.5 py-0.5 pv-mono text-[12px] text-pv-text" value={list} onChange={(e) => setList(e.target.value)} />
        <Pill onClick={() => c.act({ type: "send", sids, size })} disabled={c.busy || !okList} tone="primary">
          send
        </Pill>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-pv-text-faint">
        End SIDs:
        {PRESETS.map(([l, x]) => (
          <button key={l} type="button" className="rounded border border-pv-border px-1.5 py-0.5 text-pv-text-muted hover:text-pv-text" onClick={() => setList(x.join(", "))}>
            [{l}]
          </button>
        ))}
        <span>R<i>N</i>&apos;s End SID = 2001:db8:100:<i>N</i>:1::</span>
      </div>
      {!c.s.ticket && (
        <div className="flex flex-wrap items-center gap-2">
          <Pill onClick={() => c.act({ type: "wipe-r3" })} disabled={c.busy || !!c.s.wiped} tone="danger">
            Wipe R3&apos;s SRv6
          </Pill>
          <span className="text-[11.5px] text-pv-text-faint">for challenge 5: rebuild it from R3&apos;s console</span>
        </div>
      )}
    </div>
  );
}

const SPEC: SpLabSpec<SxState, SxAction, SxSnap> = {
  title: "SRv6 Foundations Lab",
  note: () => "six routers · IS-IS IPv6 · SRv6 locators and End SIDs · IOS XR",
  fresh: (seq) => createSxNet(seq),
  vendors: ["cisco"],
  apply: sxApply,
  snapOf: (s) => ({ view: s.view }),
  ticketAction: (id) => ({ type: "ticket", id: id as SxTicketId }),
  levels: SX_LEVELS,
  gate: {
    title: "You can read and send SRv6",
    points: [
      "An SRv6 SID is an IPv6 address: a locator that routes to the node, and a function the node binds to a behavior.",
      "Transit routers forward on the destination address only — plain IPv6, no SRv6 needed.",
      "For several SIDs the headend adds an SRH: the list reversed, Segments Left pointing at the next one; the active SID is the DA.",
      "End: decrement Segments Left and copy the next SID into the DA; PSP removes the SRH, USD removes the outer header.",
      "A locator route says how to reach a node; only a local SID says what it does.",
    ],
    more: "The engineering workspace gives you R1–R6 in their own windows (locator, local SIDs, interfaces with metric and MTU, an IOS XR console with commit), plain IPv6 and SRv6 test traffic with packet sizes, five challenges and five tickets.",
  },
  stage,
  footer: (c) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
      <span>
        End SIDs: <b className="pv-mono text-pv-text">{SX_ROUTERS.filter((r) => c.live.view.sids[r].some((x) => x.behavior === "End")).length}/6</b> · R1 encapsulation source: <b className="pv-mono text-pv-text">{c.s.cfg.R1.encap ?? "none"}</b>
      </span>
      <span className="text-pv-text-faint">badges: each router&apos;s End SID · violet path: with an SRH</span>
    </div>
  ),
  devices: SX_ROUTERS,
  device: (id) => ({ label: id, icon: role(id), tone: "#22d3ee", sub: `${SX_LO(id as SxR)} · IOS XR` }),
  openFrom: 1,
  window: (id, c) => <RouterUI c={c} r={id as SxR} />,
  tools: [
    { id: "sids", label: "Local SIDs", render: (c) => <Sids c={c} /> },
    { id: "locs", label: "Locators", render: (c) => <Locs c={c} /> },
    { id: "headers", label: "Headers, hop by hop", render: (c) => <Headers c={c} /> },
    { id: "mtu", label: "MTU", render: (c) => <Mtu c={c} /> },
    { id: "path", label: "Last test, step by step", render: (c) => <PathView c={c} /> },
    { id: "log", label: "Log", render: (c) => <LogTool c={c} /> },
  ],
  toolsLabel: { learn: "What the routers know", eng: "Tools" },
  evidence,
  composer: (c) => <Composer c={c} />,
  investigate: [
    "On R3: show segment-routing srv6 sid. Which SIDs does R3 own, and what does each do?",
    "On R1: show route ipv6 2001:db8:100:3:1::. Which route carries R3's SID — and which router does R1 send it to?",
    "Send [R3 End, R6 End] and read the headers hop by hop. Where does Segments Left change, and where does the SRH disappear?",
    "On R1: ping 2001:db8:100:3:1::, then ping 2001:db8:100:3:9::. Why does one answer?",
    "Send 1460 bytes with three SIDs. How big is the packet on the wire?",
  ],
  challenges: SX_CHALLENGES,
  tickets: SX_TICKETS.map((t) => ({ id: t.id, title: t.title, report: t.report, reproLabel: t.reproLabel, repro: t.repro })),
  ticketIntro: "Testers report lost traffic, not causes. Each ticket is this network after a change with one real thing wrong. Reproduce it, walk the evidence (plain IPv6, R1's encapsulation, locators, local SIDs, MTU), name the cause, fix it on the router and prove it with a fresh test.",
  reproHint: "Watch where the packet dies and what its destination address was there.",
  fixHint: "Fix it on the router (its window or its console — commit to apply), check the locators and local SIDs, then send the same test again.",
  causes: SX_CAUSES,
  feedback: sxCauseFeedback,
  proofs: sxProofs,
  ladder: (s) => sxLadder(s),
  text: (v, t) => spText(v, t),
  runCard: (c) => (
    <Card title="Result">
      <TestView c={c} />
    </Card>
  ),
};

export function SxLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SpLabWorkspace spec={SPEC} open={open} onClose={onClose} />;
}
