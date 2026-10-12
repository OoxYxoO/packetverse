"use client";

import { useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { SpLabWorkspace, type SpCtx, type SpLabSpec } from "@/components/sp-lab/SpLabWorkspace";
import { SpStage, type SpPath, type SpStageLink, type SpStageNode } from "@/components/sp-lab/SpStage";
import { SpConsole } from "@/components/sp-lab/SpDesk";
import { Card, Kv, Pill, STable, Tabs } from "@/components/sp-lab/SpUi";
import { spClone, spStamp } from "@/components/sp-lab/spKit";
import type { SpDevCli } from "@/components/sp-lab/spCli";
import type { TopoView } from "@/components/presentation/Visuals";
import {
  DEFAULT_MTU,
  IS_CAUSES,
  IS_LINKS,
  IS_LO,
  IS_ROUTERS,
  IS_SYS,
  IS_TICKETS,
  adjKey,
  areaOf,
  createIsNet,
  hearFail,
  hex8,
  ifLevels,
  isApply,
  isCauseFeedback,
  isIfs,
  isLadder,
  isLspId,
  isProofs,
  isRib,
  linkUp,
  lookup,
  spfTree,
  sysOf,
  type IfName,
  type IsAction,
  type IsLink,
  type IsR,
  type IsRtr,
  type IsSnap,
  type IsState,
  type IsTicketId,
  type IsType,
  type Lvl,
} from "@/lib/sim-engine/scenarios/isisNet";
import { isPipe, isSets, type IsCliApi } from "./isCli";
import { IS_LEVELS } from "./isLearn";
import { IS_CHALLENGES } from "./isPractice";
import { ifName, isText } from "./isNames";

/**
 * IS-IS Lab — the six-router Level-2 core on the shared Service Provider lab workspace.
 *   LEARN                  6 levels (isLearn): neighbors · LSPs and flooding · SPF and the RIB · metrics and overload ·
 *                          what hellos must agree on · reading the evidence
 *   ENGINEERING WORKSPACE  Investigate (traffic tests, link failures; router windows with interfaces, the LSDB, the
 *                          routes and an IOS XR / Junos console) · Challenges (six) · Troubleshoot (five tickets)
 * One model (isisNet.ts) produces every hello, adjacency, LSP, SPF result, route, capture and verdict.
 */

type Ctx = SpCtx<IsState, IsAction, IsSnap>;
const POS: Record<IsR, { x: number; y: number; cx: number; cy: number }> = {
  PE1: { x: 8, y: 50, cx: 11, cy: 50 },
  P1: { x: 33, y: 17, cx: 33, cy: 15 },
  P2: { x: 67, y: 17, cx: 67, cy: 15 },
  PE2: { x: 92, y: 50, cx: 89, cy: 50 },
  P3: { x: 33, y: 83, cx: 33, cy: 85 },
  P4: { x: 67, y: 83, cx: 67, cy: 85 },
};
const PE_TONE = "#34d399";
const P_TONE = "#67e8f9";
const role = (r: IsR) => (r.startsWith("PE") ? "PE" : "P");
const mOf = (s: IsState, r: IsR, ifn: IfName) => s.cfg[r].ifs[ifn]!.metric;
const linkState = (s: IsState, adj: IsSnap["adj"], l: IsLink): { state: SpStageLink["state"]; note: string } => {
  if (!linkUp(s, l)) return { state: "down", note: "link down" };
  const a = adj[adjKey(l.a, l.ai)];
  const b = adj[adjKey(l.b, l.bi)];
  if (a?.state === "UP" && b?.state === "UP") return { state: "up", note: "" };
  if (a || b) return { state: "blocked", note: "one-way" };
  if (!s.cfg[l.a].ifs[l.ai]!.isis && !s.cfg[l.b].ifs[l.bi]!.isis) return { state: "off", note: "no IS-IS" };
  return { state: "standby", note: "no adjacency" };
};
const fmtRoute = (s: IsState, r: IsR, ip: string) => {
  const rt = lookup(isRib(s.cfg, s.phys, s.adj, s.db, r), ip);
  return rt ? (rt.kind.startsWith("i") ? `metric ${rt.metric} via ${rt.nh.map((h) => h.nbr).join(" + ")}` : "connected") : "no route";
};

/** What the core runs right now: its levels and areas (both can change in the lab). */
function domainLabel(s: IsState) {
  const on = IS_ROUTERS.filter((r) => s.cfg[r].on && s.cfg[r].net);
  const areas = [...new Set(on.map((r) => areaOf(s.cfg[r].net)))].sort();
  const l1 = on.some((r) => s.cfg[r].isType !== "level-2-only");
  return `IS-IS ${l1 ? "Level 1 + 2" : "Level 2"} · area${areas.length > 1 ? "s" : ""} ${areas.join(" + ") || "—"}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------------------------------------------
function stage(c: Ctx, p: { moment?: Parameters<SpLabSpec<IsState, IsAction, IsSnap>["stage"]>[1]["moment"]; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) {
  const s = c.s;
  const adj = c.live.adj;
  const nodes: SpStageNode[] = IS_ROUTERS.map((r) => ({ id: r, label: r, role: role(r), tone: role(r) === "PE" ? PE_TONE : P_TONE, sub: IS_LO[r], ...POS[r] }));
  const links: SpStageLink[] = IS_LINKS.map((l) => {
    const st = linkState(s, adj, l);
    const ma = mOf(s, l.a, l.ai);
    const mb = mOf(s, l.b, l.bi);
    const metric = ma === mb ? `${ma}` : `${l.a} ${ma} · ${l.b} ${mb}`;
    return { id: l.id, a: l.a, b: l.b, state: st.state, label: st.note ? `${metric} · ${st.note}` : metric };
  });
  const views: Record<string, TopoView> = {};
  for (const r of IS_ROUTERS) {
    const own = c.live.db[r][2][r];
    if (own?.ol) views[r] = { badge: { text: "OL", tone: "bad" } };
    if (!s.cfg[r].on || !s.cfg[r].net) views[r] = { ring: "dim", badge: { text: "no IS-IS", tone: "no" } };
  }
  const paths: SpPath[] = [];
  const last = s.tests[s.tests.length - 1];
  if (last && !p.moment && last.cfgSeq === s.cfgSeq) {
    paths.push({ id: "fwd", nodes: last.fwd.hops.map((h) => h.r), color: last.ok ? "#34d399" : "#f87171", offset: -1 });
    if (last.back && last.back.hops.map((h) => h.r).reverse().join() !== last.fwd.hops.map((h) => h.r).join()) paths.push({ id: "back", nodes: last.back.hops.map((h) => h.r), color: "#fbbf24", offset: 1, dashed: true });
  }
  return <SpStage nodes={nodes} links={links} paths={paths} views={views} moment={p.moment} momentKey={p.momentKey} compact={p.compact} onNode={p.onNode} selected={p.selected} regions={[{ x: 2, y: 3, w: 96, h: 94, label: domainLabel(s), color: "#22d3ee" }]} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Panels (also used by the Learn evidence)
// ---------------------------------------------------------------------------------------------------------------
export function AdjTable({ c, only }: { c: Ctx; only?: IsR }) {
  const rows = (only ? [only] : IS_ROUTERS).flatMap((r) =>
    isIfs(r).map((i) => {
      const a = c.live.adj[adjKey(r, i.ifn)];
      const tone = a?.state === "UP" ? "ok" : a ? "warn" : "faint";
      return [r, ifName(c.vendor, i.ifn), i.peer, [a ? (a.state === "UP" ? "Up" : "Initializing") : linkUp(c.s, i.link) ? "—" : "link down", tone], a?.lvls.length ? `L${a.lvls.join("+")}` : "—"] as (string | [string, "ok" | "warn" | "faint"])[];
    }),
  );
  return <STable cols={only ? ["Router", "Interface", "Neighbor", "State", "Level"] : ["Router", "Interface", "Neighbor", "State", "Level"]} rows={rows} />;
}
function NetTable({ c }: { c: Ctx }) {
  return <STable cols={["Router", "NET", "Area", "System ID", "Loopback", "IS type"]} rows={IS_ROUTERS.map((r) => [r, c.s.cfg[r].net || "—", c.s.cfg[r].net ? areaOf(c.s.cfg[r].net) : "—", c.s.cfg[r].net ? sysOf(c.s.cfg[r].net) : "—", IS_LO[r], c.s.cfg[r].isType])} />;
}
export function LspView({ c, holder, orig, lvl = 2 }: { c: Ctx; holder: IsR; orig: IsR; lvl?: Lvl }) {
  const l = c.live.db[holder][lvl][orig];
  if (!l) return <p className="text-[12px] text-pv-text-faint">{holder} holds no Level-{lvl} LSP from {orig}.</p>;
  return (
    <div className="space-y-1">
      <p className="pv-mono text-[12px] text-pv-text">
        {isLspId(orig)} · seq {hex8(l.seq)} · checksum 0x{l.csum.toString(16).padStart(4, "0")} · OL {l.ol ? 1 : 0} · area {l.area}
      </p>
      <STable cols={["TLV", "Entry", "Metric"]} rows={[...l.nbrs.map((n) => ["22 IS reach", `${n.to}.00`, n.metric] as (string | number)[]), ...l.pfx.map((p) => ["135 IP reach", `${p.p}/${p.len}`, p.metric] as (string | number)[])]} />
    </div>
  );
}
function LsdbList({ c, r, onPick }: { c: Ctx; r: IsR; onPick?: (o: IsR) => void }) {
  const lsps = IS_ROUTERS.map((o) => c.live.db[r][2][o]).filter(Boolean);
  return (
    <STable
      cols={["LSP ID", "Seq", "Checksum", "OL", ""]}
      rows={lsps.map((l) => [
        [isLspId(l!.orig), l!.orig === r ? "hi" : undefined],
        hex8(l!.seq),
        `0x${l!.csum.toString(16).padStart(4, "0")}`,
        [l!.ol ? "1" : "0", l!.ol ? "bad" : undefined],
        onPick ? (
          <button key="b" type="button" className="text-[11px] text-pv-cyan-soft" onClick={() => onPick(l!.orig)}>
            open
          </button>
        ) : (
          ""
        ),
      ])}
      empty={`${r} holds no LSPs (IS-IS isn't running).`}
    />
  );
}
function SeqMatrix({ c }: { c: Ctx }) {
  return (
    <STable
      cols={["Holder", ...IS_ROUTERS.map((o) => `${o}`)]}
      rows={IS_ROUTERS.map((h) => [
        h,
        ...IS_ROUTERS.map((o) => {
          const l = c.live.db[h][2][o];
          const cur = c.s.own[o][2];
          return [l ? `#${l.seq}` : "—", !l ? "faint" : cur && l.seq < cur.seq ? "warn" : cur && l.seq === cur.seq && c.snap ? "ok" : undefined] as [string, "faint" | "warn" | "ok" | undefined];
        }),
      ])}
    />
  );
}
export function SpfView({ c, r }: { c: Ctx; r: IsR }) {
  const tree = spfTree(c.live.db, r, 2);
  if (!tree.length) return <p className="text-[12px] text-pv-text-faint">{r} has no Level-2 SPF result.</p>;
  return (
    <div className="space-y-1">
      <STable cols={["Router", "Distance", "First hop(s)", "Via"]} rows={tree.map((n) => [n.r, n.r === r ? "0 (root)" : n.dist, n.r === r ? "—" : n.first.join(" + "), n.r === r ? "—" : n.prev.join(", ")])} />
      {IS_ROUTERS.filter((o) => c.live.db[r][2][o] && !tree.some((n) => n.r === o)).length > 0 && <p className="text-[11.5px] text-pv-warning">In the LSDB but unreachable (fails the two-way check or behind an overloaded node): {IS_ROUTERS.filter((o) => c.live.db[r][2][o] && !tree.some((n) => n.r === o)).join(", ")}</p>}
    </div>
  );
}
export function RibView({ c, r, all }: { c: Ctx; r: IsR; all?: boolean }) {
  const rib = isRib(c.s.cfg, c.s.phys, c.live.adj, c.live.db, r).filter((x) => all || (x.kind.startsWith("i") && x.len === 32));
  return <STable cols={["Prefix", "Type", "Metric", "Next hop(s)"]} rows={rib.map((x) => [`${x.p}/${x.len}`, x.kind === "C" ? "connected" : x.kind === "L" ? "local" : `IS-IS ${x.kind.slice(2)}`, x.kind.startsWith("i") ? x.metric : "—", x.nh.length ? x.nh.map((h) => `${h.ip} (${h.nbr}, ${ifName(c.vendor, h.ifn)})`).join(" · ") : ifName(c.vendor, x.ifn ?? "")])} />;
}
function PathView({ c, n = 1 }: { c: Ctx; n?: number }) {
  const ts = c.s.tests.slice(-n);
  if (!ts.length) return <p className="text-[12px] text-pv-text-faint">Run the test above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The result appears when the run has finished.</p>;
  return (
    <div className="space-y-1">
      {ts.map((t) => (
        <div key={t.id} className={clsx("rounded-lg border px-2 py-1 text-[12.5px]", t.ok ? "border-pv-success/40" : "border-pv-danger/40")}>
          <p className="font-semibold text-pv-text">
            {t.kind === "trace" ? "traceroute" : "ping"} {t.dst} from {t.from}: <span className={t.ok ? "text-pv-success" : "text-pv-danger"}>{t.ok ? "success" : "failed"}</span>
          </p>
          <p className="pv-mono text-[12px] text-pv-text-muted">
            there: {t.fwd.hops.map((h) => h.r).join(" → ")}
            {t.back ? ` · back: ${t.back.hops.map((h) => h.r).join(" → ")}` : ""}
          </p>
          {t.fwd.hops.some((h) => h.ecmp > 1) && <p className="text-[11.5px] text-pv-text-faint">ECMP at {t.fwd.hops.filter((h) => h.ecmp > 1).map((h) => `${h.r} (${h.ecmp} paths)`).join(", ")}: this flow was hashed onto one of them.</p>}
        </div>
      ))}
    </div>
  );
}
function MatchView({ c, link }: { c: Ctx; link: string }) {
  const l = IS_LINKS.find((x) => x.id === link)!;
  const s = c.s;
  const side = (r: IsR, ifn: IfName) => {
    const f = s.cfg[r].ifs[ifn]!;
    return { inIsis: f.isis, levels: ifLevels(s.cfg, r, ifn), circuit: f.circuit, isType: s.cfg[r].isType, area: s.cfg[r].net ? areaOf(s.cfg[r].net) : "—", mtu: f.mtu, key: f.key ? "set" : "none", passive: f.passive };
  };
  const a = side(l.a, l.ai);
  const b = side(l.b, l.bi);
  const row = (k: string, va: ReactNode, vb: ReactNode, bad?: boolean) => [k, [va, bad ? "warn" : undefined], [vb, bad ? "warn" : undefined]] as (string | [ReactNode, "warn" | undefined])[];
  const ab = hearFail(s.cfg, s.phys, l, l.a, l.b);
  const ba = hearFail(s.cfg, s.phys, l, l.b, l.a);
  return (
    <div className="space-y-1.5">
      <STable
        cols={["", `${l.a} ${ifName(c.vendor, l.ai)}`, `${l.b} ${ifName(c.vendor, l.bi)}`]}
        rows={[
          row("In IS-IS", a.inIsis ? "yes" : "no", b.inIsis ? "yes" : "no", a.inIsis !== b.inIsis),
          row("is-type · circuit-type", `${a.isType} · ${a.circuit}`, `${b.isType} · ${b.circuit}`),
          row("Levels it runs", a.levels.length ? `L${a.levels.join("+")}` : "none", b.levels.length ? `L${b.levels.join("+")}` : "none", !a.levels.some((x) => b.levels.includes(x))),
          row("Area", a.area, b.area, a.area !== b.area),
          row("MTU (hello padded to)", `${a.mtu} (${a.mtu - 17} B)`, `${b.mtu} (${b.mtu - 17} B)`, a.mtu !== b.mtu),
          row("Hello key", a.key, b.key, a.key !== b.key || (a.key === "set" && s.cfg[l.a].ifs[l.ai]!.key !== s.cfg[l.b].ifs[l.bi]!.key)),
        ]}
      />
      <ul className="space-y-0.5 text-[12px]">
        <li className={ab ? "text-pv-warning" : "text-pv-success"}>
          {l.b} {ab ? `drops ${l.a}'s hellos: ${ab}` : `accepts ${l.a}'s hellos`}
        </li>
        <li className={ba ? "text-pv-warning" : "text-pv-success"}>
          {l.a} {ba ? `drops ${l.b}'s hellos: ${ba}` : `accepts ${l.b}'s hellos`}
        </li>
        <li className="text-pv-text-muted">
          Adjacency: {l.a} {c.live.adj[adjKey(l.a, l.ai)]?.state ?? "none"} · {l.b} {c.live.adj[adjKey(l.b, l.bi)]?.state ?? "none"}
        </li>
      </ul>
    </div>
  );
}
function IihView({ c }: { c: Ctx }) {
  const caps = c.s.caps.filter((x) => x.kind === "IIH" && x.at === adjKey("P3", "ge-0/0/2") && x.dir === "in").slice(-1);
  return (
    <div className="space-y-1 text-[12px]">
      <STable
        cols={["Layer", "Field", "Value"]}
        rows={[
          ["802.3", "Destination", "09:00:2B:00:00:05 (AllISs)"],
          ["LLC", "DSAP · SSAP · control", "0xFE · 0xFE · 0x03 — no IP header"],
          ["IS-IS", "Discriminator · PDU type", "0x83 · 17 (point-to-point IIH)"],
          ["IS-IS", "Circuit type · System ID", `L2 · ${IS_SYS.P1} (P1)`],
          ["TLV 240", "Three-way state", "Down → Initializing → Up, with the neighbor's System ID"],
          ["TLV 8", "Padding", `to the interface MTU (${DEFAULT_MTU - 17} bytes)`],
        ]}
      />
      {caps.map((x) => (
        <p key={x.t} className="pv-mono text-[11.5px] text-pv-text-muted">
          last IIH P3 received on {ifName(c.vendor, "ge-0/0/2")}: {x.text}
        </p>
      ))}
    </div>
  );
}
function Ladder({ c }: { c: Ctx }) {
  if (c.busy) return <p className="text-[12px] text-pv-text-faint">The ladder fills in when the run has finished.</p>;
  return (
    <ol className="space-y-1">
      {isLadder(c.s).map((r, i) => (
        <li key={r.k} className="rounded-lg border border-pv-border/70 px-2 py-1 text-[12px]">
          <b className="text-pv-text">
            {i + 1}. {r.title}
          </b>{" "}
          <span className="text-pv-text-muted">{c.text(r.text)}</span>
        </li>
      ))}
    </ol>
  );
}

function evidence(key: string, c: Ctx): ReactNode {
  const [k, arg] = key.split(":");
  switch (k) {
    case "nets":
      return (
        <Card title="Each router's NET">
          <NetTable c={c} />
        </Card>
      );
    case "adj":
      return (
        <Card title={arg ? `${arg}'s adjacencies` : "Adjacencies, router by router"}>
          <AdjTable c={c} only={arg as IsR | undefined} />
        </Card>
      );
    case "iih":
      return (
        <Card title="The hello that did it (P2P IIH)">
          <IihView c={c} />
        </Card>
      );
    case "lsp":
      return (
        <Card title={`${arg}'s LSP, as PE2 holds it`}>
          <LspView c={c} holder="PE2" orig={arg as IsR} />
        </Card>
      );
    case "seq":
      return (
        <Card title="Which copy of each LSP every router holds (Level 2 sequence numbers)">
          <SeqMatrix c={c} />
          <p className="mt-1 text-[11px] text-pv-text-faint">Amber = an older copy still waiting for the flood; follows the run step by step.</p>
        </Card>
      );
    case "lsdb":
      return (
        <Card title={`${arg}'s link-state database`}>
          <LsdbList c={c} r={arg as IsR} />
        </Card>
      );
    case "spf":
      return (
        <Card title={`${arg}'s SPF result (Level 2)`}>
          <SpfView c={c} r={arg as IsR} />
        </Card>
      );
    case "rib":
      return (
        <Card title={`${arg}'s IS-IS routes to the loopbacks`}>
          <RibView c={c} r={arg as IsR} />
        </Card>
      );
    case "path":
      return (
        <Card title="What the traffic did">
          <PathView c={c} />
        </Card>
      );
    case "paths":
      return (
        <Card title="Both directions">
          <PathView c={c} n={2} />
        </Card>
      );
    case "match":
      return (
        <Card title={`Both ends of ${arg}, compared`}>
          <MatchView c={c} link={arg} />
        </Card>
      );
    case "ladder":
      return (
        <Card title="The evidence ladder, read from the network">
          <Ladder c={c} />
        </Card>
      );
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Router window
// ---------------------------------------------------------------------------------------------------------------
function cfgDiff(r: IsR, a: IsRtr, b: IsRtr): string {
  const out: string[] = [];
  if (a.on !== b.on) out.push(b.on ? "IS-IS process configured" : "IS-IS process removed");
  if (a.net !== b.net) out.push(`NET ${a.net || "—"} → ${b.net || "—"}`);
  if (a.isType !== b.isType) out.push(`is-type ${b.isType}`);
  if (a.overload !== b.overload) out.push(b.overload ? "overload bit set" : "overload bit cleared");
  if (a.lo !== b.lo) out.push(b.lo ? "Loopback0 added to IS-IS" : "Loopback0 removed from IS-IS");
  for (const i of isIfs(r)) {
    const x = a.ifs[i.ifn]!;
    const y = b.ifs[i.ifn]!;
    if (x.isis !== y.isis) out.push(`${i.ifn} ${y.isis ? "added to" : "removed from"} IS-IS`);
    if (x.circuit !== y.circuit) out.push(`${i.ifn} circuit-type ${y.circuit}`);
    if (x.metric !== y.metric) out.push(`${i.ifn} metric ${x.metric} → ${y.metric}`);
    if (x.mtu !== y.mtu) out.push(`${i.ifn} MTU ${x.mtu} → ${y.mtu}`);
    if (x.key !== y.key) out.push(`${i.ifn} hello key ${y.key ? "set" : "removed"}`);
    if (x.passive !== y.passive) out.push(`${i.ifn} ${y.passive ? "passive" : "not passive"}`);
    if (x.shut !== y.shut) out.push(`${i.ifn} ${y.shut ? "shut down" : "enabled"}`);
    if (x.iso !== y.iso) out.push(`${i.ifn} family iso ${y.iso ? "added" : "removed"}`);
  }
  return out.join(", ") || "no change";
}
function devCli(c: Ctx, r: IsR): SpDevCli<IsRtr> {
  return {
    host: r,
    running: c.s.cfg[r],
    hist: c.s.hist[r],
    cand: c.cli.cand[r] as IsRtr | undefined,
    setCand: (x) => c.cli.setCand(r, x),
    xr: c.cli.xr[r] ?? [],
    setXr: (st) => c.cli.setXr(r, st),
    edit: !!c.cli.edit[r],
    setEdit: (b) => c.cli.setEdit(r, b),
    commit: (cfg, how) => c.act({ type: "cfg", dev: r, cfg, text: `${cfgDiff(r, c.s.cfg[r], cfg)} (${how}, ${c.vendor === "cisco" ? "IOS XR" : "Junos"})` }),
    ask: c.cli.setQuestion,
  };
}
const sel = "rounded border border-pv-border bg-pv-bg px-1 py-0.5 text-[12px] text-pv-text disabled:opacity-40";
function RouterUI({ c, r }: { c: Ctx; r: IsR }) {
  const [tab, setTab] = useState<"router" | "lsdb" | "routes" | "term" | "log">("router");
  const [pick, setPick] = useState<IsR | undefined>(undefined);
  const s = c.s;
  const cfg = s.cfg[r];
  const change = (f: (x: IsRtr) => void) => {
    const n = spClone(cfg);
    f(n);
    c.act({ type: "cfg", dev: r, cfg: n, text: `${cfgDiff(r, cfg, n)} (from ${r}'s window)` });
  };
  const api: IsCliApi = { s, act: c.act, dev: devCli(c, r) };
  const sets = isSets(api, r);
  return (
    <div>
      <Tabs
        tabs={[
          ["router", "Router"],
          ["lsdb", "LSDB"],
          ["routes", "Routes"],
          ["term", "Console"],
          ["log", "Log"],
        ]}
        cur={tab}
        set={setTab}
      />
      <div className="space-y-2 p-3">
        {tab === "router" && (
          <>
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Kv k="NET" v={cfg.net || "none"} tone={cfg.net ? undefined : "bad"} />
              <Kv k="Area · System ID" v={cfg.net ? `${areaOf(cfg.net)} · ${sysOf(cfg.net)}` : "—"} />
              <Kv k="IS type" v={cfg.isType} />
              <Kv k="Loopback0" v={`${IS_LO[r]}/32 · ${cfg.lo ? "in IS-IS (passive)" : "NOT in IS-IS"}`} tone={cfg.lo ? undefined : "warn"} />
              <Kv k="Overload bit" v={cfg.overload ? "SET" : "clear"} tone={cfg.overload ? "bad" : undefined} />
              <Kv k="LSP" v={s.own[r][2] ? `${isLspId(r)} seq ${hex8(s.own[r][2]!.seq)}` : "none"} />
            </div>
            <div className="max-w-full overflow-x-auto">
              <table className="w-full min-w-max text-left text-[12px]">
                <thead className="text-pv-text-faint">
                  <tr>
                    <th className="px-1">Interface</th>
                    <th className="px-1">Peer</th>
                    <th className="px-1">IS-IS</th>
                    <th className="px-1">Circuit</th>
                    <th className="px-1">Metric</th>
                    <th className="px-1">MTU</th>
                    <th className="px-1">Adjacency</th>
                  </tr>
                </thead>
                <tbody>
                  {isIfs(r).map((i) => {
                    const f = cfg.ifs[i.ifn]!;
                    const a = s.adj[adjKey(r, i.ifn)];
                    return (
                      <tr key={i.ifn} className="border-t border-pv-border/40">
                        <td className="px-1 py-0.5 pv-mono text-pv-text">{ifName(c.vendor, i.ifn)}</td>
                        <td className="px-1 text-pv-text-muted">{i.peer}</td>
                        <td className="px-1">
                          <input type="checkbox" aria-label={`IS-IS on ${i.ifn}`} checked={f.isis} disabled={c.busy} onChange={(e) => change((x) => void (x.ifs[i.ifn]!.isis = e.target.checked))} />
                        </td>
                        <td className="px-1">
                          <select aria-label={`circuit type ${i.ifn}`} className={sel} value={f.circuit} disabled={c.busy || !f.isis} onChange={(e) => change((x) => void (x.ifs[i.ifn]!.circuit = e.target.value as IsType))}>
                            {(["level-1-2", "level-1", "level-2-only"] as IsType[]).map((v) => (
                              <option key={v}>{v}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-1">
                          <select aria-label={`metric ${i.ifn}`} className={sel} value={f.metric} disabled={c.busy || !f.isis} onChange={(e) => change((x) => void (x.ifs[i.ifn]!.metric = +e.target.value))}>
                            {[...new Set([5, 10, 20, 50, 100, f.metric])].sort((a2, b2) => a2 - b2).map((v) => (
                              <option key={v}>{v}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-1">
                          <select aria-label={`MTU ${i.ifn}`} className={sel} value={f.mtu} disabled={c.busy} onChange={(e) => change((x) => void (x.ifs[i.ifn]!.mtu = +e.target.value))}>
                            {[...new Set([1514, 9014, f.mtu])].map((v) => (
                              <option key={v}>{v}</option>
                            ))}
                          </select>
                        </td>
                        <td className={clsx("px-1", a?.state === "UP" ? "text-pv-success" : a ? "text-pv-warning" : "text-pv-text-faint")}>{a ? `${a.state === "UP" ? "Up" : "Init"} · ${a.nbr}` : linkUp(s, i.link) ? "none" : "link down"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2">
              <Pill onClick={() => change((x) => void (x.overload = !x.overload))} disabled={c.busy}>
                {cfg.overload ? "Clear the overload bit" : "Set the overload bit"}
              </Pill>
              <Pill onClick={() => change((x) => void (x.lo = !x.lo))} disabled={c.busy}>
                {cfg.lo ? "Remove Loopback0 from IS-IS" : "Add Loopback0 to IS-IS"}
              </Pill>
            </div>
            <p className="text-[11.5px] text-pv-text-faint">Changes here are committed at once. In the Console, edits wait in the candidate until you commit — the way engineers work.</p>
          </>
        )}
        {tab === "lsdb" && (
          <>
            <LsdbList c={c} r={r} onPick={setPick} />
            {pick && <LspView c={c} holder={r} orig={pick} />}
          </>
        )}
        {tab === "routes" && (
          <>
            <RibView c={c} r={r} all />
            <p className="text-[11.5px] text-pv-text-faint">Connected and local routes come from the interfaces; every IS-IS route comes from {r}&apos;s own SPF on its own LSDB.</p>
          </>
        )}
        {tab === "term" && <SpConsole c={c.cli} sets={sets} os={c.vendor === "cisco" ? "iosxr" : "junos"} host={r} vendor={c.vendor} setVendor={c.setVendor} pipeCtx={c.vendor === "juniper" ? isPipe(api, r) : undefined} />}
        {tab === "log" && (
          <ul className="space-y-0.5">
            {s.sys
              .filter((x) => x.dev === r)
              .slice(-30)
              .reverse()
              .map((x, i) => (
                <li key={i} className="pv-mono text-[11.5px] text-pv-text-muted">
                  {spStamp(x.t).hms} {x.kind === "commit" ? "configuration committed" : x.kind === "auth" ? `hello from ${x.nbr} on ${ifName(c.vendor, x.ifn!)} dropped: ${x.why}` : `adjacency to ${x.nbr} on ${ifName(c.vendor, x.ifn!)} ${x.kind === "adj-up" ? "Up" : x.kind === "adj-init" ? "Initializing" : `Down (${x.why})`}`}
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
function RouterPick({ v, set }: { v: IsR; set: (r: IsR) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {IS_ROUTERS.map((r) => (
        <button key={r} type="button" aria-pressed={v === r} onClick={() => set(r)} className={clsx("rounded-md px-2 py-0.5 text-[11.5px] font-semibold", v === r ? "bg-pv-cyan/15 text-pv-text" : "text-pv-text-muted hover:text-pv-text")}>
          {r}
        </button>
      ))}
    </div>
  );
}
function LsdbTool({ c }: { c: Ctx }) {
  const [r, setR] = useState<IsR>("PE1");
  const [o, setO] = useState<IsR | undefined>(undefined);
  return (
    <div className="space-y-2">
      <RouterPick v={r} set={setR} />
      <LsdbList c={c} r={r} onPick={setO} />
      {o && <LspView c={c} holder={r} orig={o} />}
    </div>
  );
}
function SpfTool({ c }: { c: Ctx }) {
  const [r, setR] = useState<IsR>("PE1");
  return (
    <div className="space-y-2">
      <RouterPick v={r} set={setR} />
      <SpfView c={c} r={r} />
      <RibView c={c} r={r} />
    </div>
  );
}
function CaptureTool({ c }: { c: Ctx }) {
  const points = IS_ROUTERS.flatMap((r) => isIfs(r).map((i) => adjKey(r, i.ifn)));
  const [at, setAt] = useState(adjKey("P1", "ge-0/0/1"));
  const caps = c.s.caps.filter((x) => x.at === at).slice(-40).reverse();
  return (
    <div className="space-y-2">
      <select aria-label="Capture point" className={sel} value={at} onChange={(e) => setAt(e.target.value)}>
        {points.map((p) => (
          <option key={p} value={p}>
            {p.split("|")[0]} {ifName(c.vendor, p.split("|")[1])}
          </option>
        ))}
      </select>
      <STable cols={["Time", "Dir", "PDU", "Detail", "Fate"]} rows={caps.map((x) => [spStamp(x.t).hms, x.dir, x.kind, c.text(x.text), [x.drop ? `dropped: ${x.drop}` : "ok", x.drop ? "bad" : "ok"]])} empty="Nothing captured here yet — change something or run a test." />
    </div>
  );
}
function CounterTool({ c }: { c: Ctx }) {
  return (
    <div className="space-y-2">
      <STable
        cols={["Interface", "IIH in/out", "IIH dropped", "Giants", "Auth fail", "LSP in/out"]}
        rows={IS_ROUTERS.flatMap((r) =>
          isIfs(r).map((i) => {
            const k = c.s.ctr[`${r} ${i.ifn}`];
            return [`${r} ${ifName(c.vendor, i.ifn)}`, `${k.iihIn}/${k.iihOut}`, [k.iihDrop, k.iihDrop ? "warn" : "faint"], [k.giants, k.giants ? "bad" : "faint"], [k.authFail, k.authFail ? "bad" : "faint"], `${k.lspIn}/${k.lspOut}`];
          }),
        )}
      />
      <Pill onClick={() => c.act({ type: "clear-counters" })}>Clear all counters</Pill>
    </div>
  );
}
function LogTool({ c }: { c: Ctx }) {
  return (
    <ul className="space-y-0.5">
      {[...c.s.log].reverse().slice(0, 60).map((l, i) => (
        <li key={i} className={clsx("text-[12px]", l.tone === "warn" ? "text-pv-warning" : l.tone === "ok" ? "text-pv-success" : "text-pv-text-muted")}>
          <span className="pv-mono text-pv-text-faint">{spStamp(l.t).hms}</span> {c.text(l.text)}
        </li>
      ))}
    </ul>
  );
}
function Composer({ c }: { c: Ctx }) {
  const [from, setFrom] = useState<IsR>("PE1");
  const [to, setTo] = useState<IsR>("PE2");
  return (
    <div className="space-y-2 rounded-xl border border-pv-border p-2">
      <p className="text-[12px] font-semibold text-pv-text">Traffic (sourced from the loopback)</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <select aria-label="From" className={sel} value={from} onChange={(e) => setFrom(e.target.value as IsR)}>
          {IS_ROUTERS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <span className="text-pv-text-faint">→</span>
        <select aria-label="To" className={sel} value={to} onChange={(e) => setTo(e.target.value as IsR)}>
          {IS_ROUTERS.filter((r) => r !== from).map((r) => (
            <option key={r} value={r}>
              {r} ({IS_LO[r]})
            </option>
          ))}
        </select>
        <Pill onClick={() => c.act({ type: "ping", from, dst: IS_LO[to === from ? "PE2" : to], src: IS_LO[from] })} disabled={c.busy} tone="primary">
          ping
        </Pill>
        <Pill onClick={() => c.act({ type: "trace", from, dst: IS_LO[to === from ? "PE2" : to], src: IS_LO[from] })} disabled={c.busy}>
          traceroute
        </Pill>
      </div>
      <p className="text-[12px] font-semibold text-pv-text">Links</p>
      <div className="flex flex-wrap gap-1">
        {IS_LINKS.map((l) => (
          <button key={l.id} type="button" disabled={c.busy} onClick={() => c.act({ type: "link", link: l.id, up: !c.s.phys[l.id] })} className={clsx("rounded-md border px-2 py-0.5 text-[11.5px] font-semibold disabled:opacity-40", c.s.phys[l.id] ? "border-pv-border text-pv-text-muted hover:text-pv-text" : "border-pv-danger/60 text-pv-danger")}>
            {c.s.phys[l.id] ? `✂ ${l.id}` : `↺ ${l.id}`}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Pill onClick={() => c.act({ type: "wipe-pe1" })} disabled={c.busy || !!c.s.wiped} tone="danger">
          Wipe PE1&apos;s IS-IS
        </Pill>
        <span className="text-[11.5px] text-pv-text-faint">for challenge 6 — then rebuild it in PE1&apos;s console</span>
      </div>
    </div>
  );
}
function RunCard({ c }: { c: Ctx }) {
  const t = c.s.tests[c.s.tests.length - 1];
  const last = c.s.last;
  if (last?.kind === "converge")
    return (
      <Card title="After the change: PE1's view">
        <p className="text-[12px] text-pv-text-muted">
          PE1 → 10.0.0.4: {fmtRoute(c.s, "PE1", "10.0.0.4")} · PE2 → 10.0.0.1: {fmtRoute(c.s, "PE2", "10.0.0.1")}
        </p>
      </Card>
    );
  if (!t) return null;
  return (
    <Card title="Result">
      <PathView c={c} />
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The spec
// ---------------------------------------------------------------------------------------------------------------
const SPEC: SpLabSpec<IsState, IsAction, IsSnap> = {
  title: "IS-IS Lab",
  note: () => "PE1 · P1–P4 · PE2 · Level 2",
  fresh: (seq) => createIsNet(seq),
  apply: isApply,
  snapOf: (s) => ({ adj: s.adj, db: s.db }),
  ticketAction: (id) => ({ type: "ticket", id: id as IsTicketId }),
  levels: IS_LEVELS,
  gate: {
    title: "You can follow an IS-IS core from hello to route",
    points: [
      "Hellos ride straight in Ethernet frames (LLC, no IP). An adjacency is Up only when each router hears its own System ID in the other's hello — the three-way handshake.",
      "Each router originates one LSP: its neighbors with its own outgoing metrics, and its prefixes. Any change → sequence + 1, flooded to every router, so every LSDB is identical.",
      "Each router runs its own SPF on that shared map (two-way check, overload = no transit) and installs IPv4 routes. Traffic just follows the routing tables.",
      "Metrics are outgoing and per direction. Equal-cost paths are all installed; each flow is hashed onto one.",
      "Before any adjacency, hellos must agree: a common level (Level 1 also needs the same area), an MTU the hello fits in, the same key. A failure on one side shows up as Initializing on the other.",
    ],
    more: "The engineering workspace gives you all six routers in their own windows (interfaces, the LSDB, the routes, an IOS XR / Junos console with real commit-based configuration), traffic tests and link failures, captures and counters, six challenges and five tickets to solve from evidence.",
  },
  stage,
  footer: (c) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
      <span>
        PE1 → PE2: <b className="pv-mono text-pv-text">{fmtRoute(c.s, "PE1", "10.0.0.4")}</b>
      </span>
      <span>
        PE2 → PE1: <b className="pv-mono text-pv-text">{fmtRoute(c.s, "PE2", "10.0.0.1")}</b>
      </span>
      <span className="text-pv-text-faint">link labels: metric (per direction when they differ)</span>
    </div>
  ),
  devices: IS_ROUTERS,
  device: (id, c) => ({ label: id, icon: role(id as IsR), tone: role(id as IsR) === "PE" ? PE_TONE : P_TONE, sub: `${IS_LO[id as IsR]} · ${c.s.cfg[id as IsR].net || "no NET"} · ${c.vendor === "cisco" ? "IOS XR" : "Junos"} view` }),
  openFrom: 1,
  window: (id, c) => <RouterUI c={c} r={id as IsR} />,
  tools: [
    { id: "adj", label: "Adjacencies", render: (c) => <AdjTable c={c} /> },
    { id: "lsdb", label: "LSDB", render: (c) => <LsdbTool c={c} /> },
    { id: "spf", label: "SPF", render: (c) => <SpfTool c={c} /> },
    { id: "cap", label: "Captures", render: (c) => <CaptureTool c={c} /> },
    { id: "ctr", label: "Counters", render: (c) => <CounterTool c={c} /> },
    { id: "log", label: "Log", render: (c) => <LogTool c={c} /> },
  ],
  toolsLabel: { learn: "What the routers know", eng: "Tools" },
  evidence,
  composer: (c) => <Composer c={c} />,
  investigate: [
    "Fail P1–P2 and read P1's show isis spf-log / show isis spf log: which trigger ran SPF, and which LSPs changed sequence?",
    "Set P1's metric toward P2 to 100 and trace both directions. Then set P2's metric toward P1 to 100 as well: are the paths symmetric again?",
    "Put P3 in area 49.0002 (its NET). Which adjacencies change? Why not?",
    "Raise one end's MTU to 9014. Which router shows Initializing, which shows nothing — and which interface counts giants?",
    "Remove Loopback0 from IS-IS on one router: what disappears from its LSP, and who notices?",
  ],
  challenges: IS_CHALLENGES,
  tickets: IS_TICKETS.map((t) => ({ id: t.id, title: t.title, report: t.report, reproLabel: t.reproLabel, repro: t.repro })),
  ticketIntro: "Users report symptoms, not causes. Each ticket is this core after a normal morning, with one real thing wrong. Reproduce it, walk the evidence (links, adjacencies, LSPs, SPF, routes), name the cause, fix it on the router — the console commits like a real one — and prove it with a fresh test.",
  reproHint: "Watch which path the traffic takes, and where it stops.",
  fixHint: "Fix it on the router (its window, or its console — commit to apply), check the router's own state (show isis adjacency, show isis database, the routes), then run the test again. An accepted command isn't a repaired network.",
  causes: IS_CAUSES,
  feedback: isCauseFeedback,
  proofs: isProofs,
  ladder: (s) => isLadder(s),
  runCard: (c) => <RunCard c={c} />,
  text: isText,
};

export function IsisLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SpLabWorkspace spec={SPEC} open={open} onClose={onClose} />;
}
