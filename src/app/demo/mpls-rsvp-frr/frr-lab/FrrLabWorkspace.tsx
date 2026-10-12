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
  CE_NET,
  FR_CAUSES,
  FR_LINKS,
  FR_LO,
  FR_ROUTERS,
  FR_TICKETS,
  IMPLICIT_NULL,
  byName,
  createFrNet,
  frApply,
  frCauseFeedback,
  frLadder,
  frProofs,
  ifsOf,
  linkAlive,
  linkOf,
  lspName,
  type FrAction,
  type FrBypass,
  type FrCe,
  type FrCfg,
  type FrLsp,
  type FrR,
  type FrSnap,
  type FrState,
  type FrTicketId,
  type IfName,
} from "@/lib/sim-engine/scenarios/frrNet";
import { frPipe, frSets, type FrCliApi } from "./frCli";
import { FR_LEVELS } from "./frLearn";
import { FR_CHALLENGES } from "./frPractice";

/**
 * Fast Reroute Lab — the guided lesson's six routers on the shared Service Provider lab workspace.
 *   LEARN                  6 levels (frLearn): why local repair · PLR, merge point, bypass · a link fails · a router
 *                          fails · detection decides · reading the evidence
 *   ENGINEERING WORKSPACE  Investigate (traffic, failure drills, restore, re-optimize; router windows with interfaces,
 *                          tunnels and bypasses and an IOS XR / Junos console) · Challenges (five) · Troubleshoot (five)
 * One model (frrNet.ts) produces every LSP, bypass, binding, label and drill verdict.
 */

type Ctx = SpCtx<FrState, FrAction, FrSnap>;
type Node = FrR | FrCe;
const POS: Record<Node, { x: number; y: number; cx: number; cy: number }> = {
  CE1: { x: 4, y: 35, cx: 6, cy: 12 },
  R1: { x: 15, y: 35, cx: 12, cy: 35 },
  R3: { x: 34, y: 35, cx: 32, cy: 35 },
  R5: { x: 56, y: 35, cx: 54, cy: 35 },
  R7: { x: 76, y: 35, cx: 74, cy: 35 },
  R6: { x: 90, y: 35, cx: 90, cy: 35 },
  CE6: { x: 97, y: 12, cx: 94, cy: 12 },
  R4: { x: 55, y: 82, cx: 54, cy: 84 },
};
const TONE = { R: "#22d3ee", CE: "#fbbf24" };
const LSP_COLORS = ["#a78bfa", "#34d399", "#f472b6"];
const sec = (ms: number) => (ms === Infinity ? "until repaired" : ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s` : `${ms} ms`);

function stage(c: Ctx, p: { moment?: SpMoment<FrSnap>; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) {
  const s = c.s;
  const v = c.live.view;
  const f = c.live.fail;
  const nodes: SpStageNode[] = (Object.keys(POS) as Node[]).map((d) => ({ id: d, label: d, role: d.startsWith("CE") ? "CE" : d === "R1" || d === "R6" ? "PE" : "P", tone: d.startsWith("CE") ? TONE.CE : TONE.R, sub: d.startsWith("CE") ? CE_NET[d as FrCe].net.replace("/24", "") : FR_LO[d as FrR], ...POS[d] }));
  const links: SpStageLink[] = [
    { id: "CE1-R1", a: "CE1", b: "R1", state: "dim" },
    { id: "R6-CE6", a: "R6", b: "CE6", state: "dim" },
    ...FR_LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b, state: (linkAlive(s.cfg, f, l) ? "up" : "down") as SpStageLink["state"], label: !linkAlive(s.cfg, f, l) ? "failed" : l.silent ? "DWDM" : String(l.metric) })),
  ];
  const views: Record<string, TopoView> = {};
  for (const r of FR_ROUTERS) {
    if (f.nodes.includes(r)) {
      views[r] = { ring: "bad", badge: { text: "down", tone: "bad" } };
      continue;
    }
    const n = v.bypasses.filter((b) => b.plr === r);
    if (n.length) views[r] = { badge: { text: `${n.filter((b) => b.up).length}/${n.length} bypass`, tone: n.every((b) => b.up) ? "yes" : "warn" } };
  }
  const paths: SpPath[] = [];
  v.lsps.forEach((l, i) => {
    if (l.state === "up" && l.path) paths.push({ id: l.key, nodes: l.path, color: LSP_COLORS[i % LSP_COLORS.length], label: l.head === "R1" ? lspName(s.os, l) : undefined, offset: 1.4 });
  });
  for (const b of v.bypasses.filter((x) => x.up && v.lsps.some((l) => l.prot[x.plr] === x.key))) paths.push({ id: b.key, nodes: b.path!, color: "#fbbf24", dashed: true, offset: -1.4 });
  return <SpStage nodes={nodes} links={links} paths={paths} views={views} moment={p.moment} momentKey={p.momentKey} compact={p.compact} onNode={p.onNode} selected={p.selected} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------------------------
function Lsps({ c }: { c: Ctx }) {
  const rows = c.live.view.lsps.map((l) => {
    const t = c.s.cfg[l.head].tunnels.find((x) => x.id === l.id)!;
    return [`${l.head} ${lspName(c.s.os, l)}`, t.dst || "—", t.frr === "off" ? ["none", "warn"] : t.frr, [l.state, l.state === "up" ? "ok" : "bad"], l.state === "up" ? l.path!.join("→") : l.why ?? "", Object.keys(l.prot).join(", ") || "—"] as (string | [string, "ok" | "bad" | "warn"])[];
  });
  return <STable cols={["LSP", "To", "Protection asked", "State", "Path / why", "Protected at"]} rows={rows} empty="No LSPs are configured." />;
}
function Bypasses({ c, only }: { c: Ctx; only?: FrR }) {
  const v = c.live.view;
  const rows = v.bypasses.filter((b) => !only || b.plr === only).map((b: FrBypass) => [b.plr, byName(c.s.os, b, v), b.type === "nhop" ? "NHOP (link)" : "NNHOP (node)", `→ ${b.tail}`, b.up ? ["up", "ok"] : ["down", "bad"], b.up ? b.path!.join("→") : b.why ?? "", v.lsps.filter((l) => l.prot[b.plr] === b.key).map((l) => lspName(c.s.os, l)).join(", ") || "—"] as (string | [string, "ok" | "bad"])[]);
  return <STable cols={["PLR", "Bypass", "Protects", "Merge point", "State", "Path / why", "LSPs bound"]} rows={rows} empty="No bypass exists." />;
}
function FrrDb({ c }: { c: Ctx }) {
  const v = c.live.view;
  const rows = v.lsps.filter((l) => l.state === "up").flatMap((l) =>
    l.path!.slice(0, -1).map((r, i) => {
      const b = l.prot[r] ? v.bypasses.find((x) => x.key === l.prot[r]) : undefined;
      const nx = l.path![i + 1];
      return [lspName(c.s.os, l), r, `${r}–${nx}`, b ? [`${b.type.toUpperCase()} → ${b.tail}`, "ok"] : ["unprotected", "warn"], b ? `${b.labels[b.path![1]] === IMPLICIT_NULL ? "—" : b.labels[b.path![1]]} over ${l.labels[b.tail] === IMPLICIT_NULL ? "IP" : l.labels[b.tail]}` : "—"] as (string | [string, "ok" | "warn"])[];
    }),
  );
  return <STable cols={["LSP", "PLR", "Protected link", "Bound bypass", "Labels pushed in a repair (bypass over MP's)"]} rows={rows} empty="No LSP is up." />;
}
function Labels({ c }: { c: Ctx }) {
  const rows = c.live.view.lsps.filter((l) => l.state === "up").flatMap((l) =>
    l.path!.map((r, i) => {
      const inL = l.labels[r];
      const nx = l.path![i + 1];
      const outL = nx ? l.labels[nx] : undefined;
      return [lspName(c.s.os, l), r, i === 0 ? "—" : inL === IMPLICIT_NULL ? "implicit-null" : String(inL), i === 0 ? `push ${outL}` : !nx ? "IP lookup" : outL === IMPLICIT_NULL ? `pop (PHP)` : `swap → ${outL}`];
    }),
  );
  return <STable cols={["LSP", "Router", "Label it asked for", "What it does"]} rows={rows} empty="No LSP is up." />;
}
function DrillView({ c }: { c: Ctx }) {
  const d = c.s.drills[c.s.drills.length - 1];
  if (!d) return <p className="text-[12px] text-pv-text-faint">Run a drill above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The result appears when the run has finished.</p>;
  const hit = d.results.filter((r) => r.how !== "unaffected");
  return (
    <div className="space-y-1">
      <p className="text-[12.5px] font-semibold text-pv-text">Drill: {d.what.replace("link:", "").replace("node:", "").replace("-", "–")} fails</p>
      {hit.length ? (
        hit.map((r) => (
          <div key={r.lsp} className={clsx("rounded-lg border px-2 py-1 text-[12px]", r.how === "local" && r.lossMs < 1000 ? "border-pv-success/40" : "border-pv-danger/40")}>
            <p className="text-pv-text">
              <b>{r.name}</b>: <span className={r.how === "local" && r.lossMs < 1000 ? "text-pv-success" : "text-pv-danger"}>{r.how === "local" ? (r.lossMs < 1000 ? "repaired locally" : "repaired locally, but late") : r.how === "none" ? "down" : "re-signaled by the headend"}</span> — traffic lost ~{sec(r.lossMs)}
            </p>
            <p className="text-[11.5px] text-pv-text-muted">
              PLR {r.plr} · detection {r.detect === "light" ? "loss of light (10 ms)" : r.detect === "bfd" ? "BFD (45 ms)" : "IS-IS hold time (30 s)"} · {r.why}
            </p>
            {r.newPath && <p className="pv-mono text-[11px] text-pv-text-faint">afterwards: {r.newPath.join(" → ")}</p>}
          </div>
        ))
      ) : (
        <p className="text-[12px] text-pv-text-muted">No LSP crossed the failure.</p>
      )}
    </div>
  );
}
function TestView({ c }: { c: Ctx }) {
  const t = c.s.tests[c.s.tests.length - 1];
  if (!t) return <p className="text-[12px] text-pv-text-faint">Send traffic above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The result appears when the run has finished.</p>;
  return (
    <div className={clsx("rounded-lg border px-2 py-1 text-[12.5px]", t.ok ? "border-pv-success/40" : "border-pv-danger/40")}>
      <p className="font-semibold text-pv-text">
        traffic from {t.from}: <span className={t.ok ? "text-pv-success" : "text-pv-danger"}>{t.ok ? "delivered" : "lost"}</span>
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
      {frLadder(c.s).map((r, i) => (
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
    case "lsps":
      return card("LSPs", <Lsps c={c} />);
    case "bypasses":
      return card("Bypasses at each PLR", <Bypasses c={c} />);
    case "frrdb":
      return card("Protection at every hop", <FrrDb c={c} />);
    case "labels":
      return card("Labels along each LSP", <Labels c={c} />);
    case "drill":
      return card("What the failure cost", <DrillView c={c} />);
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
function cfgDiff(a: FrCfg, b: FrCfg): string {
  const out: string[] = [];
  for (const k of Object.keys(b.ifs) as IfName[]) {
    const x = a.ifs[k];
    const y = b.ifs[k];
    if (x.shut !== y.shut) out.push(`${k} ${y.shut ? "shutdown" : "no shutdown"}`);
    if (x.te !== y.te) out.push(`${k} ${y.te ? "TE interface" : "no longer TE"}`);
    if (x.bfd !== y.bfd) out.push(`${k} BFD ${y.bfd ? "on" : "off"}`);
    if (x.auto !== y.auto || x.nhopOnly !== y.nhopOnly) out.push(`${k} automatic bypasses ${y.auto ? (y.nhopOnly ? "NHOP only" : "NHOP + NNHOP") : "off"}`);
    if (x.rsvp !== y.rsvp) out.push(`${k} RSVP ${y.rsvp === undefined ? "removed" : "changed"}`);
  }
  for (const t of b.tunnels) {
    const o = a.tunnels.find((x) => x.id === t.id);
    if (!o) out.push(`${t.name} created`);
    else if (JSON.stringify(o) !== JSON.stringify(t)) out.push(`${t.name} changed`);
  }
  for (const t of a.tunnels) if (!b.tunnels.some((x) => x.id === t.id)) out.push(`${t.name} removed`);
  if (JSON.stringify(a.paths) !== JSON.stringify(b.paths)) out.push("explicit paths changed");
  return out.join(", ") || "no change";
}
function devCli(c: Ctx, r: FrR): SpDevCli<FrCfg> {
  return {
    host: r,
    running: c.s.cfg[r],
    hist: c.s.hist[r],
    cand: c.cli.cand[r] as FrCfg | undefined,
    setCand: (x) => c.cli.setCand(r, x),
    xr: c.cli.xr[r] ?? [],
    setXr: (st) => c.cli.setXr(r, st),
    edit: !!c.cli.edit[r],
    setEdit: (b) => c.cli.setEdit(r, b),
    commit: (cfg, how) => c.act({ type: "cfg", dev: r, cfg, text: `${cfgDiff(c.s.cfg[r], cfg)} (${how}, ${c.vendor === "cisco" ? "IOS XR" : "Junos"})` }),
    ask: c.cli.setQuestion,
  };
}
function RouterUI({ c, r }: { c: Ctx; r: FrR }) {
  const [tab, setTab] = useState<"router" | "tunnels" | "term" | "log">("router");
  const s = c.s;
  const cfg = s.cfg[r];
  const change = (f: (x: FrCfg) => void) => {
    const n = spClone(cfg);
    f(n);
    c.act({ type: "cfg", dev: r, cfg: n, text: `${cfgDiff(cfg, n)} (from ${r}'s window)` });
  };
  const api: FrCliApi = { s, act: c.act, dev: devCli(c, r) };
  const heads = c.live.view.lsps.filter((l: FrLsp) => l.head === r);
  return (
    <div>
      <Tabs tabs={[["router", "Interfaces"], ["tunnels", "Tunnels & bypasses"], ["term", "Console"], ["log", "Log"]]} cur={tab} set={setTab} />
      <div className="space-y-2 p-3">
        {tab === "router" && (
          <>
            <Kv k="TE router ID" v={FR_LO[r]} />
            <div className="max-w-full overflow-x-auto">
              <table className="w-full min-w-max text-left text-[12px]">
                <thead className="text-pv-text-faint">
                  <tr>
                    {["Interface", "To", "Up", "TE", "BFD", "Auto bypass", "NHOP only"].map((h) => (
                      <th key={h} className="px-1">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ifsOf(r).map((x) => {
                    const ic = cfg.ifs[x.ifn];
                    return (
                      <tr key={x.ifn} className="border-t border-pv-border/40">
                        <td className="px-1 py-0.5 pv-mono text-pv-text">{ifName(c.vendor, x.ifn)}</td>
                        <td className="px-1 text-pv-text-muted">
                          {x.peer}
                          {x.link.silent ? " (DWDM)" : ""}
                        </td>
                        {(["shut", "te", "bfd", "auto", "nhopOnly"] as const).map((k) => (
                          <td key={k} className="px-1">
                            <input type="checkbox" aria-label={`${k} ${x.ifn}`} checked={k === "shut" ? !ic.shut : ic[k]} disabled={c.busy || (k === "nhopOnly" && !ic.auto)} onChange={(e) => change((y) => void (k === "shut" ? (y.ifs[x.ifn].shut = !e.target.checked) : (y.ifs[x.ifn][k] = e.target.checked)))} />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11.5px] text-pv-text-faint">Checkboxes are committed at once. Tunnels, protection requests and manual bypasses are configured in the Console (candidate + commit).</p>
          </>
        )}
        {tab === "tunnels" && (
          <>
            {heads.map((l) => {
              const t = cfg.tunnels.find((x) => x.id === l.id)!;
              return (
                <Card key={l.key} title={`${lspName(s.os, l)} → ${t.dst || "?"}`} right={<span className={clsx("text-[11.5px] font-semibold", l.state === "up" ? "text-pv-success" : "text-pv-danger")}>{l.state}</span>}>
                  <Kv k="Protection requested" v={t.frr === "off" ? "none" : t.frr === "node" ? "node + link" : "link"} tone={t.frr === "off" ? "warn" : undefined} />
                  <Kv k={l.state === "up" ? "Path" : "Why down"} v={l.state === "up" ? l.path!.join(" → ") : l.why ?? "—"} />
                  <Kv k="Protected at" v={Object.keys(l.prot).join(", ") || "no hop"} />
                </Card>
              );
            })}
            <Bypasses c={c} only={r} />
          </>
        )}
        {tab === "term" && <SpConsole c={c.cli} sets={frSets(api, r)} os={c.vendor === "cisco" ? "iosxr" : "junos"} host={r} vendor={c.vendor} setVendor={c.setVendor} pipeCtx={c.vendor === "juniper" ? frPipe(api, r) : undefined} />}
        {tab === "log" && (
          <ul className="space-y-0.5">
            {s.sys.filter((x) => x.dev === r).slice(-30).reverse().map((x, i) => (
              <li key={i} className="pv-mono text-[11.5px] text-pv-text-muted">
                {spStamp(x.t).hms} {x.kind === "commit" ? "configuration committed" : x.kind === "frr" ? `${x.what} switched to ${x.why}` : `${x.what} ${x.kind === "up" ? "up" : `down (${x.why})`}`}
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
const DRILLS = [...FR_LINKS.map((l) => `link:${l.id}`), "node:R3", "node:R4", "node:R5", "node:R7"];
function Composer({ c }: { c: Ctx }) {
  const [from, setFrom] = useState<FrCe>("CE1");
  const [what, setWhat] = useState("node:R5");
  const sel = "rounded border border-pv-border bg-pv-bg px-1 py-0.5 text-[12px] text-pv-text";
  const failed = c.s.fail.links.length + c.s.fail.nodes.length > 0;
  return (
    <div className="space-y-2 rounded-xl border border-pv-border p-2">
      <p className="text-[12px] font-semibold text-pv-text">Traffic and failure drills</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <select aria-label="From" className={sel} value={from} onChange={(e) => setFrom(e.target.value as FrCe)}>
          <option value="CE1">CE1 → CE6</option>
          <option value="CE6">CE6 → CE1</option>
        </select>
        <Pill onClick={() => c.act({ type: "test", from })} disabled={c.busy} tone="primary">
          send
        </Pill>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <select aria-label="Drill" className={sel} value={what} onChange={(e) => setWhat(e.target.value)}>
          {DRILLS.map((d) => (
            <option key={d} value={d}>
              {d.startsWith("link:") ? `link ${d.slice(5).replace("-", "–")}${linkOf(d.slice(5, 7) as FrR, d.slice(8) as FrR)?.silent ? " (DWDM)" : ""}` : `router ${d.slice(5)}`} fails
            </option>
          ))}
        </select>
        <Pill onClick={() => c.act({ type: "drill", what })} disabled={c.busy} tone="danger">
          Run the drill
        </Pill>
        <Pill onClick={() => c.act({ type: "restore" })} disabled={c.busy || !failed}>
          Repair failures
        </Pill>
        <Pill onClick={() => c.act({ type: "reopt" })} disabled={c.busy}>
          Re-optimize
        </Pill>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Pill onClick={() => c.act({ type: "wipe-r3" })} disabled={c.busy || !!c.s.wiped} tone="danger">
          Wipe R3&apos;s protection
        </Pill>
        <span className="text-[11.5px] text-pv-text-faint">for challenge 5 · every drill starts from a repaired network</span>
      </div>
    </div>
  );
}

const SPEC: SpLabSpec<FrState, FrAction, FrSnap> = {
  title: "Fast Reroute Lab",
  note: () => "tunnel-te1 R1 → R6 · bypasses at every PLR",
  fresh: (seq, vendor) => createFrNet(seq, vendor === "cisco" ? "xr" : "junos"),
  vendorAction: (v) => ({ type: "os", os: v === "cisco" ? "xr" : "junos" }),
  apply: frApply,
  snapOf: (s) => ({ view: s.view, fail: s.fail }),
  ticketAction: (id) => ({ type: "ticket", id: id as FrTicketId }),
  levels: FR_LEVELS,
  gate: {
    title: "You can protect an LSP with fast reroute",
    points: [
      "Without protection a failure waits for the headend: PathErr, IS-IS, CSPF, signaling — about 1.5 s of loss.",
      "The router before the failure (PLR) keeps a pre-signaled bypass; it rejoins the LSP at the merge point, which receives its usual label.",
      "NHOP bypasses protect the link; only an NNHOP bypass — around the next router — protects against that router failing.",
      "Repair starts at detection: loss of light is instant, a silent failure needs BFD.",
      "After a local repair the headend re-optimizes onto a new path and the bypass is released.",
    ],
    more: "The engineering workspace gives you all six routers in their own windows (interfaces with TE, BFD and automatic bypass settings, tunnels and bypasses, an IOS XR / Junos console with commit), traffic, failure drills, five challenges and five tickets.",
  },
  stage,
  footer: (c) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
      <span>
        bypasses up: <b className="pv-mono text-pv-text">{c.s.view.bypasses.filter((b) => b.up).length}</b> / {c.s.view.bypasses.length}
      </span>
      <span className="text-pv-text-faint">solid line: tunnel-te1 · dashed amber: bypasses bound to it · DWDM: a silent span</span>
    </div>
  ),
  devices: FR_ROUTERS,
  device: (id, c) => ({ label: id, icon: id === "R1" || id === "R6" ? "PE" : "P", tone: TONE.R, sub: `${FR_LO[id as FrR]} · ${c.vendor === "cisco" ? "IOS XR" : "Junos"} view` }),
  openFrom: 1,
  window: (id, c) => <RouterUI c={c} r={id as FrR} />,
  tools: [
    { id: "lsps", label: "LSPs", render: (c) => <Lsps c={c} /> },
    { id: "byp", label: "Bypasses", render: (c) => <Bypasses c={c} /> },
    { id: "frrdb", label: "Protection", render: (c) => <FrrDb c={c} /> },
    { id: "drill", label: "Last drill", render: (c) => <DrillView c={c} /> },
    { id: "labels", label: "Labels", render: (c) => <Labels c={c} /> },
    { id: "log", label: "Log", render: (c) => <LogTool c={c} /> },
  ],
  toolsLabel: { learn: "What the routers know", eng: "Tools" },
  evidence,
  composer: (c) => <Composer c={c} />,
  investigate: [
    "On R3, read show mpls traffic-eng fast-reroute database (IOS XR) or show rsvp session detail (Junos): which bypass protects tunnel-te1, and which label does it put underneath?",
    "Drill R5 failing, then R7 failing. Why can one be repaired locally and the other not?",
    "Make tunnel-te1 request link protection only and drill R3–R5, then R5.",
    "Turn BFD off on R3–R5 and drill that span. Then drill R5–R7. What is different about the two links?",
    "After a drill, repair the failure and look at tunnel-te1's path. Then re-optimize.",
  ],
  challenges: FR_CHALLENGES,
  tickets: FR_TICKETS.map((t) => ({ id: t.id, title: t.title, report: t.report, reproLabel: t.reproLabel, repro: t.repro })),
  ticketIntro: "Users report outages, not causes. Each ticket is this network after a change with one real thing wrong. Reproduce it with the failure drill, walk the evidence (protection requested, the PLR and its bypasses, detection), name the cause, fix it and prove it with a fresh drill.",
  reproHint: "Watch which router detects the failure and whether it repairs locally.",
  fixHint: "After a drill the network stays failed: press Repair failures and Re-optimize to look at the normal state. Fix it on the router (its window, or its console — commit to apply), check the bypasses and what tunnel-te1 is bound to, then run the drill again. An accepted command isn't a repaired network.",
  causes: FR_CAUSES,
  feedback: frCauseFeedback,
  proofs: frProofs,
  ladder: (s) => frLadder(s),
  text: (v, t) => spText(v, t),
  runCard: (c, run) => <Card title="Result">{run.kind === "drill" ? <DrillView c={c} /> : <TestView c={c} />}</Card>,
};

export function FrrLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SpLabWorkspace spec={SPEC} open={open} onClose={onClose} />;
}
