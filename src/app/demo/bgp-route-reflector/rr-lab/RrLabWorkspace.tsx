"use client";

import { useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { SpLabWorkspace, type SpCtx, type SpLabSpec } from "@/components/sp-lab/SpLabWorkspace";
import { SpStage, type SpPath, type SpStageLink, type SpStageNode } from "@/components/sp-lab/SpStage";
import { SpConsole } from "@/components/sp-lab/SpDesk";
import { Card, Kv, Pill, STable, Tabs } from "@/components/sp-lab/SpUi";
import { spClone, spStamp, type SpMoment } from "@/components/sp-lab/spKit";
import type { SpDevCli } from "@/components/sp-lab/spCli";
import type { TopoView } from "@/components/presentation/Visuals";
import {
  ALL_PFX,
  CE_OF,
  advertise,
  CE_PFX,
  RR_CAUSES,
  RR_DEVS,
  RR_LO,
  RR_PES,
  RR_TICKETS,
  bestPath,
  candidates,
  clusterOf,
  createRrNet,
  devByIp,
  established,
  hostOf,
  isRr,
  rrApply,
  rrCauseFeedback,
  rrLadder,
  rrProofs,
  type RrAction,
  type RrCe,
  type RrCfg,
  type RrDev,
  type RrPath,
  type RrSnap,
  type RrState,
  type RrTicketId,
} from "@/lib/sim-engine/scenarios/rrNet";
import { rrPipe, rrSets, type RrCliApi } from "./rrCli";
import { RR_LEVELS } from "./rrLearn";
import { RR_CHALLENGES } from "./rrPractice";

/**
 * Route Reflector Lab — AS 65000 with two reflectors on the shared Service Provider lab workspace.
 *   LEARN                  6 levels (rrLearn): the full mesh and split horizon · reflectors · who hears what · loop
 *                          prevention · next hops and best paths · reading the evidence
 *   ENGINEERING WORKSPACE  Investigate (customer pings; router windows with sessions, the BGP table, advertised routes
 *                          and an IOS XR / Junos console) · Challenges (five) · Troubleshoot (five tickets)
 * One model (rrNet.ts) produces every session, UPDATE, path attribute, best path and verdict.
 */

type Ctx = SpCtx<RrState, RrAction, RrSnap>;
type Node = RrDev | RrCe;
const POS: Record<Node, { x: number; y: number; cx: number; cy: number }> = {
  RR1: { x: 30, y: 14, cx: 28, cy: 13 },
  RR2: { x: 70, y: 14, cx: 72, cy: 13 },
  PE1: { x: 10, y: 52, cx: 11, cy: 50 },
  PE2: { x: 38, y: 52, cx: 37, cy: 54 },
  PE3: { x: 62, y: 52, cx: 63, cy: 54 },
  PE4: { x: 90, y: 52, cx: 89, cy: 50 },
  CE1: { x: 10, y: 87, cx: 11, cy: 88 },
  CE2: { x: 38, y: 87, cx: 37, cy: 88 },
  CE3: { x: 62, y: 87, cx: 63, cy: 88 },
  CE4: { x: 90, y: 87, cx: 89, cy: 88 },
};
const TONE = { RR: "#a78bfa", PE: "#34d399", CE: "#fbbf24" };
const role = (d: string) => (d.startsWith("RR") ? "RR" : d.startsWith("PE") ? "PE" : "CE");
const pairKey = (a: RrDev, b: RrDev) => [a, b].sort((x, y) => RR_DEVS.indexOf(x) - RR_DEVS.indexOf(y)).join("-");

function stage(c: Ctx, p: { moment?: SpMoment<RrSnap>; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) {
  const s = c.s;
  const v = c.live.view;
  const nodes: SpStageNode[] = (Object.keys(POS) as Node[]).map((d) => ({ id: d, label: d, role: role(d), tone: TONE[role(d)], sub: d.startsWith("CE") ? CE_PFX[d as RrCe][0].replace("/24", "") : RR_LO[d as RrDev], ...POS[d] }));
  const pairs = new Map<string, { a: RrDev; b: RrDev }>();
  for (const x of v.sessions) if (x.b) pairs.set(pairKey(x.a, x.b), { a: x.a, b: x.b });
  const links: SpStageLink[] = [
    ...RR_PES.map((pe) => ({ id: `${pe}-${CE_OF[pe]}`, a: pe, b: CE_OF[pe], state: "dim" as const, label: "eBGP" })),
    ...[...pairs.values()].map(({ a, b }) => {
      const up = established(v.sessions, a, b) && established(v.sessions, b, a);
      const rrSide = isRr(s.cfg, a) ? a : isRr(s.cfg, b) ? b : undefined;
      const other = rrSide === a ? b : a;
      const kind = rrSide ? (s.cfg[rrSide].nbrs.find((x) => x.ip === RR_LO[other])?.client ? "client" : "non-client") : "iBGP";
      return { id: pairKey(a, b), a, b, state: (up ? "up" : "down") as SpStageLink["state"], label: up ? kind : "down" };
    }),
  ];
  const views: Record<string, TopoView> = {};
  for (const d of RR_DEVS) {
    if (!s.cfg[d].on) views[d] = { ring: "dim", badge: { text: "no BGP", tone: "no" } };
    else if (d.startsWith("RR")) views[d] = { badge: { text: `cluster ${clusterOf(s.cfg, d)}`, tone: "warn" } };
    else {
      const have = ALL_PFX.filter((x) => bestPath(s.cfg, v, d, x).best).length;
      views[d] = { badge: { text: `${have}/${ALL_PFX.length} prefixes`, tone: have === ALL_PFX.length ? "yes" : "bad" } };
    }
  }
  const paths: SpPath[] = [];
  const last = s.tests[s.tests.length - 1];
  if (last && !p.moment && last.cfgSeq === s.cfgSeq) paths.push({ id: "t", nodes: last.path, color: last.ok ? "#34d399" : "#f87171", offset: 0 });
  return <SpStage nodes={nodes} links={links} paths={paths} views={views} moment={p.moment} momentKey={p.momentKey} compact={p.compact} onNode={p.onNode} selected={p.selected} regions={[{ x: 2, y: 3, w: 96, h: 64, label: "AS 65000 · iBGP between loopbacks", color: "#a78bfa" }]} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------------------------
function SessionTable({ c, only }: { c: Ctx; only?: RrDev }) {
  const v = c.live.view;
  const rows = v.sessions.filter((x) => !only || x.a === only).map((x) => {
    const nb = c.s.cfg[x.a].nbrs.find((y) => y.ip === x.ip);
    return [x.a, x.ip + (x.b ? ` (${x.b})` : ""), nb?.client ? "client" : isRr(c.s.cfg, x.a) ? "non-client" : "—", [x.state, x.state === "Established" ? "ok" : "bad"], x.state === "Established" ? (c.live.view.adjIn[x.a][x.ip] ?? []).length : x.why ?? ""] as (string | number | [string, "ok" | "bad"])[];
  });
  return <STable cols={["Router", "Neighbor", "Role there", "State", "Prefixes / why"]} rows={rows} empty="No BGP sessions configured yet." />;
}
function Count() {
  const n = (k: number) => (k * (k - 1)) / 2;
  return <STable cols={["PEs", "Full mesh", "Two reflectors (each PE → one RR, RRs peer)"]} rows={[4, 10, 50, 100].map((k) => [k, n(k), k + 1])} />;
}
function Rib({ c, r }: { c: Ctx; r: RrDev }) {
  return (
    <STable
      cols={["Prefix", "Best path via", "Next hop", "Why it won / problem"]}
      rows={ALL_PFX.map((p) => {
        const bp = bestPath(c.s.cfg, c.live.view, r, p);
        return [p, bp.best ? (bp.best.from === "ebgp" ? "its CE (eBGP)" : bp.best.from) : ["—", "bad"], bp.best?.nh ?? "—", bp.best ? bp.why : [bp.why, "bad"]] as (string | [string, "bad"])[];
      })}
    />
  );
}
function PathTable({ c, r, prefix }: { c: Ctx; r: RrDev; prefix: string }) {
  const ps = candidates(c.s.cfg, c.live.view, r, prefix);
  const bp = bestPath(c.s.cfg, c.live.view, r, prefix);
  return (
    <div className="space-y-1">
      <STable
        cols={["", "From", "Next hop", "ORIGINATOR_ID", "CLUSTER_LIST", "Usable"]}
        rows={ps.map((x: RrPath) => [x === bp.best ? ["best", "ok"] : "", x.from === "ebgp" ? "CE (eBGP)" : x.from, x.nh, x.originator ?? "—", x.clusterList.join(" ") || "—", bp.valid.includes(x) ? "yes" : ["no — next hop unreachable", "bad"]] as (string | [string, "ok" | "bad"])[])}
        empty={`${r} has no path to ${prefix}.`}
      />
      {bp.best && <p className="text-[11.5px] text-pv-text-faint">Best: {bp.why}.</p>}
    </div>
  );
}
function Rules({ c }: { c: Ctx }) {
  const prefix = "10.1.1.0/24";
  const rows: (string | [string, "ok" | "faint"])[][] = [];
  for (const r of RR_DEVS) {
    for (const nb of c.s.cfg[r].nbrs) {
      const to = devByIp(nb.ip);
      if (!to) continue;
      const got = (c.live.view.adjIn[to][RR_LO[r]] ?? []).some((x) => x.prefix === prefix);
      const bp = bestPath(c.s.cfg, c.live.view, r, prefix).best;
      const src = bp ? (bp.from === "ebgp" ? "learned from its CE" : `learned from ${bp.from} (${c.s.cfg[r].nbrs.find((x) => x.ip === RR_LO[bp.from as RrDev])?.client ? "client" : "non-client"})`) : "no route";
      rows.push([`${r} → ${to}`, src, nb.client ? "client" : "non-client", got ? ["sent", "ok"] : ["not sent", "faint"]]);
    }
  }
  return <STable cols={[`${prefix}: sender → receiver`, "Sender's best path", "Receiver is", "Result"]} rows={rows} />;
}
function Drops({ c }: { c: Ctx }) {
  const rows = RR_DEVS.flatMap((d) => c.live.view.dropped[d].map((x) => [d, x.prefix, x.from, x.why]));
  return <STable cols={["Router", "Prefix", "From", "Dropped because"]} rows={rows} empty="No route was dropped by a loop check." />;
}
function BestFor({ c, prefix }: { c: Ctx; prefix: string }) {
  return <STable cols={["Router", "Exit (next hop)", "Why"]} rows={RR_DEVS.map((r) => {
    const bp = bestPath(c.s.cfg, c.live.view, r, prefix);
    return [r, bp.best ? `${bp.best.from === "ebgp" ? "its own CE" : devByIp(bp.best.nh) ?? bp.best.nh}` : "—", bp.why];
  })} />;
}
function TestView({ c }: { c: Ctx }) {
  const t = c.s.tests[c.s.tests.length - 1];
  if (!t) return <p className="text-[12px] text-pv-text-faint">Run the test above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The result appears when the run has finished.</p>;
  return (
    <div className={clsx("rounded-lg border px-2 py-1 text-[12.5px]", t.ok ? "border-pv-success/40" : "border-pv-danger/40")}>
      <p className="font-semibold text-pv-text">
        ping {t.dst} from {t.from}: <span className={t.ok ? "text-pv-success" : "text-pv-danger"}>{t.ok ? "success" : "failed"}</span>
      </p>
      <p className="pv-mono text-[11.5px] text-pv-text-muted">path: {t.path.join(" → ")}</p>
      {t.why && <p className="text-[11.5px] text-pv-warning">{t.why}</p>}
    </div>
  );
}
function Ladder({ c }: { c: Ctx }) {
  if (c.busy) return <p className="text-[12px] text-pv-text-faint">The ladder fills in when the run has finished.</p>;
  return (
    <ol className="space-y-1">
      {rrLadder(c.s).map((r, i) => (
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
  const [k, a, b] = key.split(":");
  const card = (t: string, body: ReactNode) => <Card title={t}>{body}</Card>;
  switch (k) {
    case "sessions":
      return card("BGP sessions", <SessionTable c={c} />);
    case "count":
      return card("Sessions needed", <Count />);
    case "rib":
      return card(`${a}'s best paths`, <Rib c={c} r={a as RrDev} />);
    case "path":
      return card(`${a}'s paths to ${b}`, <PathTable c={c} r={a as RrDev} prefix={b} />);
    case "rules":
      return card("Who sent 10.1.1.0/24 to whom", <Rules c={c} />);
    case "drops":
      return card("Loop-prevention drops", <Drops c={c} />);
    case "best":
      return card(`Each router's exit for ${a}`, <BestFor c={c} prefix={a} />);
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
function cfgDiff(a: RrCfg, b: RrCfg): string {
  const out: string[] = [];
  if (a.on !== b.on) out.push(b.on ? "BGP configured" : "BGP removed");
  if (a.cluster !== b.cluster) out.push(`cluster-id ${b.cluster ?? "(router ID)"}`);
  for (const nb of b.nbrs) {
    const old = a.nbrs.find((x) => x.ip === nb.ip);
    if (!old) out.push(`neighbor ${nb.ip} added${nb.client ? " (client)" : ""}`);
    else {
      if (old.client !== nb.client) out.push(`${nb.ip} ${nb.client ? "is now a client" : "no longer a client"}`);
      if (old.nhs !== nb.nhs) out.push(`${nb.ip} next-hop-self ${nb.nhs ? "on" : "off"}`);
      if (old.policy !== nb.policy) out.push(`${nb.ip} outbound policy ${nb.policy ?? "removed"}`);
      if (old.remoteAs !== nb.remoteAs) out.push(`${nb.ip} remote-as ${nb.remoteAs}`);
    }
  }
  for (const nb of a.nbrs) if (!b.nbrs.some((x) => x.ip === nb.ip)) out.push(`neighbor ${nb.ip} removed`);
  if (JSON.stringify(a.sets) !== JSON.stringify(b.sets)) out.push("prefix sets changed");
  return out.join(", ") || "no change";
}
function devCli(c: Ctx, r: RrDev): SpDevCli<RrCfg> {
  return {
    host: r,
    running: c.s.cfg[r],
    hist: c.s.hist[r],
    cand: c.cli.cand[r] as RrCfg | undefined,
    setCand: (x) => c.cli.setCand(r, x),
    xr: c.cli.xr[r] ?? [],
    setXr: (st) => c.cli.setXr(r, st),
    edit: !!c.cli.edit[r],
    setEdit: (b) => c.cli.setEdit(r, b),
    commit: (cfg, how) => c.act({ type: "cfg", dev: r, cfg, text: `${cfgDiff(c.s.cfg[r], cfg)} (${how}, ${c.vendor === "cisco" ? "IOS XR" : "Junos"})` }),
    ask: c.cli.setQuestion,
  };
}
function RouterUI({ c, r }: { c: Ctx; r: RrDev }) {
  const [tab, setTab] = useState<"router" | "table" | "adv" | "term" | "log">("router");
  const [pfx, setPfx] = useState(ALL_PFX[0]);
  const [peer, setPeer] = useState(c.s.cfg[r].nbrs[0]?.ip ?? "");
  const s = c.s;
  const cfg = s.cfg[r];
  const change = (f: (x: RrCfg) => void) => {
    const n = spClone(cfg);
    f(n);
    c.act({ type: "cfg", dev: r, cfg: n, text: `${cfgDiff(cfg, n)} (from ${r}'s window)` });
  };
  const api: RrCliApi = { s, act: c.act, dev: devCli(c, r) };
  const rr = r.startsWith("RR");
  return (
    <div>
      <Tabs tabs={[["router", "Router"], ["table", "BGP table"], ["adv", "Advertised"], ["term", "Console"], ["log", "Log"]]} cur={tab} set={setTab} />
      <div className="space-y-2 p-3">
        {tab === "router" && (
          <>
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Kv k="BGP" v={cfg.on ? `AS 65000 · router ID ${RR_LO[r]}` : "not running"} tone={cfg.on ? undefined : "bad"} />
              <Kv k="Cluster ID" v={rr ? clusterOf(s.cfg, r) : "— (not a reflector)"} />
              <Kv k="Reflects?" v={isRr(s.cfg, r) ? "yes (has clients)" : "no"} />
              <Kv k="Customer prefixes" v={RR_PES.includes(r) ? CE_PFX[CE_OF[r]].join(", ") : "—"} />
            </div>
            <div className="max-w-full overflow-x-auto">
              <table className="w-full min-w-max text-left text-[12px]">
                <thead className="text-pv-text-faint">
                  <tr>
                    {["Neighbor", "State", rr ? "Client" : "Next-hop-self", "Outbound policy"].map((h) => (
                      <th key={h} className="px-1">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cfg.nbrs.map((nb) => {
                    const x = s.view.sessions.find((y) => y.a === r && y.ip === nb.ip);
                    return (
                      <tr key={nb.ip} className="border-t border-pv-border/40">
                        <td className="px-1 py-0.5 pv-mono text-pv-text">
                          {nb.ip} {devByIp(nb.ip) ? `(${devByIp(nb.ip)})` : ""}
                        </td>
                        <td className={clsx("px-1", x?.state === "Established" ? "text-pv-success" : "text-pv-danger")}>{x?.state ?? "—"}</td>
                        <td className="px-1">
                          {rr ? (
                            <input type="checkbox" aria-label={`client ${nb.ip}`} checked={nb.client} disabled={c.busy} onChange={(e) => change((y) => void Object.assign(y.nbrs.find((z) => z.ip === nb.ip)!, { client: e.target.checked, group: undefined }))} />
                          ) : (
                            <input type="checkbox" aria-label={`next-hop-self ${nb.ip}`} checked={nb.nhs} disabled={c.busy} onChange={(e) => change((y) => void (y.nbrs.find((z) => z.ip === nb.ip)!.nhs = e.target.checked))} />
                          )}
                        </td>
                        <td className="px-1 pv-mono text-pv-text-muted">{nb.policy ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2">
              <Pill onClick={() => change((x) => void (x.on ? Object.assign(x, { on: false, nbrs: [] }) : (x.on = true)))} disabled={c.busy}>
                {cfg.on ? "Remove BGP from this router" : "Start BGP (no neighbors)"}
              </Pill>
            </div>
            <p className="text-[11.5px] text-pv-text-faint">Changes here are committed at once. New neighbors, cluster IDs and policies are configured in the Console (candidate + commit).</p>
          </>
        )}
        {tab === "table" && (
          <>
            <div className="flex flex-wrap gap-1 text-[12px]">
              {ALL_PFX.map((p) => (
                <button key={p} type="button" aria-pressed={pfx === p} onClick={() => setPfx(p)} className={clsx("rounded px-1.5 py-0.5 pv-mono", pfx === p ? "bg-pv-cyan/15 text-pv-text" : "text-pv-text-muted")}>
                  {p}
                </button>
              ))}
            </div>
            <PathTable c={c} r={r} prefix={pfx} />
            <Rib c={c} r={r} />
          </>
        )}
        {tab === "adv" && (
          <>
            <select aria-label="Neighbor" className="rounded border border-pv-border bg-pv-bg px-1 py-0.5 text-[12px] text-pv-text" value={peer} onChange={(e) => setPeer(e.target.value)}>
              {cfg.nbrs.map((nb) => (
                <option key={nb.ip} value={nb.ip}>
                  {nb.ip} {devByIp(nb.ip) ? `(${devByIp(nb.ip)})` : ""}
                </option>
              ))}
            </select>
            <STable cols={["Prefix", "Next hop", "ORIGINATOR_ID", "CLUSTER_LIST"]} rows={(devByIp(peer) && cfg.on && established(s.view.sessions, r, devByIp(peer)!) ? advertise(s.cfg, s.view, r, devByIp(peer)!) : []).map((x) => [x.prefix, x.nh, x.originator ?? "—", x.clusterList.join(" ") || "—"])} empty="Nothing is sent to this neighbor." />
          </>
        )}
        {tab === "term" && <SpConsole c={c.cli} sets={rrSets(api, r)} os={c.vendor === "cisco" ? "iosxr" : "junos"} host={r} vendor={c.vendor} setVendor={c.setVendor} pipeCtx={c.vendor === "juniper" ? rrPipe(api, r) : undefined} />}
        {tab === "log" && (
          <ul className="space-y-0.5">
            {s.sys.filter((x) => x.dev === r).slice(-30).reverse().map((x, i) => (
              <li key={i} className="pv-mono text-[11.5px] text-pv-text-muted">
                {spStamp(x.t).hms} {x.kind === "commit" ? "configuration committed" : `session to ${x.peer} ${x.kind === "up" ? "Established" : `down (${x.why})`}`}
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
function Matrix({ c }: { c: Ctx }) {
  return (
    <div className="space-y-1">
      <STable cols={["Router", ...ALL_PFX.map((p) => p.replace(".0/24", ""))]} rows={RR_DEVS.map((r) => [r, ...ALL_PFX.map((p) => {
        const b = bestPath(c.s.cfg, c.live.view, r, p).best;
        return [b ? (b.from === "ebgp" ? "own CE" : devByIp(b.nh) ?? b.nh) : candidates(c.s.cfg, c.live.view, r, p).length ? "unusable" : "—", b ? "ok" : "bad"] as [string, "ok" | "bad"];
      })])} />
      <p className="text-[11px] text-pv-text-faint">Each cell: the exit (next-hop PE) of the router&apos;s best path for that prefix.</p>
    </div>
  );
}
function PathsTool({ c }: { c: Ctx }) {
  const [r, setR] = useState<RrDev>("PE3");
  const [p, setP] = useState(ALL_PFX[0]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {RR_DEVS.map((d) => (
          <button key={d} type="button" aria-pressed={r === d} onClick={() => setR(d)} className={clsx("rounded-md px-2 py-0.5 text-[11.5px] font-semibold", r === d ? "bg-pv-cyan/15 text-pv-text" : "text-pv-text-muted")}>
            {d}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1 text-[11.5px]">
        {ALL_PFX.map((x) => (
          <button key={x} type="button" aria-pressed={p === x} onClick={() => setP(x)} className={clsx("rounded px-1.5 py-0.5 pv-mono", p === x ? "bg-pv-violet/15 text-pv-text" : "text-pv-text-muted")}>
            {x}
          </button>
        ))}
      </div>
      <PathTable c={c} r={r} prefix={p} />
    </div>
  );
}
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
  const [from, setFrom] = useState<RrCe>("CE3");
  const [to, setTo] = useState("10.1.1.0/24");
  const sel = "rounded border border-pv-border bg-pv-bg px-1 py-0.5 text-[12px] text-pv-text";
  return (
    <div className="space-y-2 rounded-xl border border-pv-border p-2">
      <p className="text-[12px] font-semibold text-pv-text">Customer traffic</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <select aria-label="From" className={sel} value={from} onChange={(e) => setFrom(e.target.value as RrCe)}>
          {(["CE1", "CE2", "CE3", "CE4"] as RrCe[]).map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <span className="text-pv-text-faint">→</span>
        <select aria-label="To" className={sel} value={to} onChange={(e) => setTo(e.target.value)}>
          {ALL_PFX.map((p) => (
            <option key={p} value={p}>
              {hostOf(p)} ({p})
            </option>
          ))}
        </select>
        <Pill onClick={() => c.act({ type: "test", from, dst: hostOf(to) })} disabled={c.busy} tone="primary">
          ping
        </Pill>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Pill onClick={() => c.act({ type: "wipe-rr2" })} disabled={c.busy || !!c.s.wiped} tone="danger">
          Wipe RR2&apos;s BGP
        </Pill>
        <span className="text-[11.5px] text-pv-text-faint">for challenge 5</span>
      </div>
    </div>
  );
}

const SPEC: SpLabSpec<RrState, RrAction, RrSnap> = {
  title: "Route Reflector Lab",
  note: () => "AS 65000 · RR1 · RR2 · PE1–PE4",
  fresh: (seq) => createRrNet(seq),
  apply: rrApply,
  snapOf: (s) => ({ view: s.view }),
  ticketAction: (id) => ({ type: "ticket", id: id as RrTicketId }),
  levels: RR_LEVELS,
  gate: {
    title: "You can follow a route through route reflectors",
    points: [
      "iBGP never re-advertises an iBGP-learned route to another iBGP peer — so without reflectors every PE needs a session to every other PE: n(n−1)/2.",
      "A reflector may re-advertise for its clients: from a client → to everyone; from a non-client → to clients only; never back to the sender. It reflects only its own best path.",
      "Reflected routes carry ORIGINATOR_ID and CLUSTER_LIST; a router drops its own routes coming back, a reflector drops routes that already passed its cluster.",
      "A reflector never changes the next hop and forwards no traffic: next-hop-self on the PEs makes customer routes usable everywhere.",
      "Most reflection faults keep every session Established: look at roles, cluster IDs, next hops and policies, not just session state.",
    ],
    more: "The engineering workspace gives you RR1, RR2 and PE1–PE4 in their own windows (sessions, the BGP table with every path's attributes, advertised routes, an IOS XR / Junos console with commit), customer pings, five challenges and five tickets.",
  },
  stage,
  footer: (c) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
      <span>
        sessions: <b className="pv-mono text-pv-text">{c.s.view.sessions.filter((x) => x.state === "Established").length / 2}</b> up
      </span>
      <span className="text-pv-text-faint">badges: prefixes each PE can use · cluster IDs · lines: iBGP sessions (client / non-client)</span>
    </div>
  ),
  devices: RR_DEVS,
  device: (id, c) => ({ label: id, icon: role(id), tone: TONE[role(id)], sub: `${RR_LO[id as RrDev]} · ${c.vendor === "cisco" ? "IOS XR" : "Junos"} view` }),
  openFrom: 1,
  window: (id, c) => <RouterUI c={c} r={id as RrDev} />,
  tools: [
    { id: "sess", label: "Sessions", render: (c) => <SessionTable c={c} /> },
    { id: "matrix", label: "Prefixes", render: (c) => <Matrix c={c} /> },
    { id: "paths", label: "Paths", render: (c) => <PathsTool c={c} /> },
    { id: "drops", label: "Loop drops", render: (c) => <Drops c={c} /> },
    { id: "log", label: "Log", render: (c) => <LogTool c={c} /> },
  ],
  toolsLabel: { learn: "What the routers know", eng: "Tools" },
  evidence,
  composer: (c) => <Composer c={c} />,
  investigate: [
    "On PE4, compare show bgp 10.1.1.0/24 (IOS XR) with show route 10.1.1.10 detail (Junos): ORIGINATOR_ID and CLUSTER_LIST.",
    "Make PE2 a non-client of RR1. What does PE1 lose? What does PE2 still get, and why?",
    "Look at 10.9.9.0/24 on every router: which exit does each choose, and from whose point of view was it chosen?",
    "Remove next-hop-self on one PE and compare the reflector's table with a client's.",
    "On Junos, move a neighbor from group CLIENTS to group CORE on a reflector and watch its role change.",
  ],
  challenges: RR_CHALLENGES,
  tickets: RR_TICKETS.map((t) => ({ id: t.id, title: t.title, report: t.report, reproLabel: t.reproLabel, repro: t.repro })),
  ticketIntro: "Users report symptoms, not causes. Each ticket is this AS after a normal morning with one real thing wrong. Reproduce it, walk the evidence (sessions, who is missing what, unusable paths, loop drops, policies), name the cause, fix it on the router and prove it with a fresh customer ping.",
  reproHint: "Watch which prefixes each PE can use.",
  fixHint: "Fix it on the router (its window, or its console — commit to apply), check the BGP table on the affected PE, then run the customer test again. An accepted command isn't a repaired route.",
  causes: RR_CAUSES,
  feedback: rrCauseFeedback,
  proofs: rrProofs,
  ladder: (s) => rrLadder(s),
  runCard: (c) => (
    <Card title="Result">
      <TestView c={c} />
    </Card>
  ),
};

export function RrLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SpLabWorkspace spec={SPEC} open={open} onClose={onClose} />;
}
