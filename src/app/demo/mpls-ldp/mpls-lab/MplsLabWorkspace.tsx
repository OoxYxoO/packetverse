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
  CE_IP,
  CE_NET,
  IMPLICIT_NULL,
  EXPLICIT_NULL,
  MP_CAUSES,
  MP_LINKS,
  MP_LO,
  MP_ROUTERS,
  MP_TICKETS,
  bgpRoute,
  createMpNet,
  ftn,
  igpAdj,
  ldpActive,
  lfib,
  lib,
  linkUp,
  mpApply,
  mpCauseFeedback,
  mpIfs,
  mpLadder,
  mpProofs,
  sessKey,
  sessionUp,
  type IfName,
  type MpAction,
  type MpCe,
  type MpDev,
  type MpLink,
  type MpPath,
  type MpR,
  type MpRtr,
  type MpSnap,
  type MpState,
  type MpTicketId,
  type OutLabel,
} from "@/lib/sim-engine/scenarios/mplsNet";
import { ceSet, mpPipe, mpSets, type MpCliApi } from "./mpCli";
import { MP_LEVELS } from "./mpLearn";
import { MP_CHALLENGES } from "./mpPractice";

/**
 * MPLS + LDP Lab — the BGP-free core on the shared Service Provider lab workspace.
 *   LEARN                  6 levels (mpLearn): why labels · LDP discovery and sessions · labels flowing upstream ·
 *                          push / swap / pop · labels following the IGP · reading the evidence
 *   ENGINEERING WORKSPACE  Investigate (customer and LSP tests, link failures; router windows with LDP, LFIB, routes
 *                          and an IOS XR / Junos console; CE hosts with a shell) · Challenges (six) · Troubleshoot (five)
 * One model (mplsNet.ts) produces every session, binding, LFIB entry, labeled hop and verdict. The OS view changes the
 * label behavior with it: IOS XR independent control, Junos ordered control.
 */

type Ctx = SpCtx<MpState, MpAction, MpSnap>;
const POS: Record<MpDev, { x: number; y: number; cx: number; cy: number }> = {
  CE1: { x: 5, y: 50, cx: 7, cy: 50 },
  PE1: { x: 20, y: 50, cx: 22, cy: 50 },
  P1: { x: 41, y: 17, cx: 40, cy: 15 },
  P2: { x: 62, y: 17, cx: 62, cy: 15 },
  PE2: { x: 80, y: 50, cx: 78, cy: 50 },
  CE2: { x: 95, y: 50, cx: 93, cy: 50 },
  P3: { x: 41, y: 83, cx: 40, cy: 85 },
  P4: { x: 62, y: 83, cx: 62, cy: 85 },
};
const TONE = { PE: "#34d399", P: "#67e8f9", CE: "#fbbf24" };
const role = (d: MpDev) => (d.startsWith("CE") ? "CE" : d.startsWith("PE") ? "PE" : "P");
const isCe = (d: string): d is MpCe => d === "CE1" || d === "CE2";
const labTxt = (l: number | undefined) => (l === undefined ? "—" : l === IMPLICIT_NULL ? "imp-null" : l === EXPLICIT_NULL ? "exp-null" : String(l));
const outTxt = (o: OutLabel) => (o === "Pop" ? "Pop" : o === "Unlabelled" ? "Unlabelled" : String(o));
const pathOf = (p: MpPath) => p.hops.map((h) => `${h.dev}${h.labels.length ? ` [${h.labels.join("|")}]` : ""}`).join(" → ");

function linkView(c: Ctx, l: MpLink): { state: SpStageLink["state"]; label: string } {
  const s = c.s;
  const v = c.live.view;
  if (!linkUp(s, l)) return { state: "down", label: "down" };
  const igp = igpAdj(s, l);
  const ldp = sessionUp(v, l.a, l.b) && !!v.hello[`${l.a}|${l.ai}`];
  const m = s.cfg[l.a].ifs[l.ai]!.metric;
  if (!igp && !ldp) return { state: "off", label: "no IS-IS · no LDP" };
  if (igp && !ldp) return { state: "blocked", label: `${m} · IS-IS only` };
  return { state: "up", label: `${m} · LDP` };
}

function stage(c: Ctx, p: { moment?: SpMoment<MpSnap>; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) {
  const s = c.s;
  const v = c.live.view;
  const nodes: SpStageNode[] = (Object.keys(POS) as MpDev[]).map((d) => ({ id: d, label: d, role: role(d), tone: TONE[role(d)], sub: isCe(d) ? CE_IP[d] : MP_LO[d as MpR], ...POS[d] }));
  const links: SpStageLink[] = [
    { id: "CE1-PE1", a: "CE1", b: "PE1", state: "up" },
    { id: "PE2-CE2", a: "PE2", b: "CE2", state: "up" },
    ...MP_LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b, ...linkView(c, l) })),
  ];
  const views: Record<string, TopoView> = {};
  for (const r of MP_ROUTERS) {
    const lab = v.local[r]["4.4.4.4"];
    if (!s.cfg[r].ldpOn) views[r] = { badge: { text: "no LDP", tone: "no" } };
    else if (lab !== undefined) views[r] = { badge: { text: `4.4.4.4: ${labTxt(lab)}`, tone: "warn" } };
  }
  const paths: SpPath[] = [];
  const last = s.tests[s.tests.length - 1];
  if (last && !p.moment && last.cfgSeq === s.cfgSeq) {
    paths.push({ id: "fwd", nodes: last.fwd.hops.map((h) => h.dev), color: last.ok ? "#34d399" : "#f87171", offset: -1 });
    if (last.back && last.back.hops.map((h) => h.dev).reverse().join() !== last.fwd.hops.map((h) => h.dev).join()) paths.push({ id: "back", nodes: last.back.hops.map((h) => h.dev), color: "#fbbf24", offset: 1, dashed: true });
  }
  return <SpStage nodes={nodes} links={links} paths={paths} views={views} moment={p.moment} momentKey={p.momentKey} compact={p.compact} onNode={p.onNode} selected={p.selected} regions={[{ x: 12, y: 3, w: 76, h: 94, label: "MPLS core · IS-IS + LDP", color: "#a78bfa" }]} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------------------------
function SessionTable({ c, only }: { c: Ctx; only?: MpR }) {
  const v = c.live.view;
  const rows = MP_LINKS.filter((l) => !only || l.a === only || l.b === only).map((l) => {
    const x = v.sessions.find((y) => sessKey(y.a, y.b) === sessKey(l.a, l.b));
    const heardA = !!v.hello[`${l.a}|${l.ai}`];
    const heardB = !!v.hello[`${l.b}|${l.bi}`];
    const st = x?.up ? "Operational" : heardA && heardB ? "discovery only" : !linkUp(c.s, l) ? "link down" : "no discovery";
    return [`${l.a}–${l.b}`, igpAdj(c.s, l) ? "Up" : "—", heardA && heardB ? "both ways" : heardA || heardB ? "one way" : "—", [st, x?.up ? "ok" : st === "discovery only" ? "warn" : "faint"], x ? (x.transport ? "reachable" : "no route") : "—"] as (string | [string, "ok" | "warn" | "faint"])[];
  });
  return <STable cols={["Link", "IS-IS", "LDP Hellos", "LDP session", "Transport (loopbacks)"]} rows={rows} />;
}
function Chain({ c }: { c: Ctx }) {
  const v = c.live.view;
  const path: MpR[] = [];
  let r: MpR = "PE1";
  for (let k = 0; k < 6; k++) {
    path.push(r);
    if (r === "PE2") break;
    const rt: { nh: { nbr: MpR }[] } | undefined = v.igp[r].find((x) => x.p === "4.4.4.4");
    if (!rt) break;
    r = rt.nh[0].nbr;
  }
  return (
    <div className="space-y-1">
      <STable
        cols={["Router (along the IS-IS path)", "Its own label for 4.4.4.4", "Outgoing (from its next hop)", "What it does"]}
        rows={path.map((x, i) => {
          const local = v.local[x]["4.4.4.4"];
          const out = x === "PE1" ? ftn(v, x, "4.4.4.4")[0]?.out : lfib(v, x).find((e) => e.fec === "4.4.4.4")?.outs[0]?.out;
          const does = x === "PE2" ? "egress: receives IP (or label 0), routes it" : i === 0 ? `PUSH ${out === undefined ? "—" : outTxt(out)}` : out === "Pop" ? "POP (penultimate hop)" : out === "Unlabelled" ? "remove label, forward IP" : out === undefined ? "no entry" : `SWAP → ${out}`;
          return [x, labTxt(local), x === "PE2" ? "—" : out === undefined ? "—" : outTxt(out), does];
        })}
      />
      <p className="text-[11.5px] text-pv-text-faint">Each router allocates its own number; the label a packet carries on a link is the one the receiving router chose.</p>
    </div>
  );
}
function Bindings({ c, r, fec = "4.4.4.4" }: { c: Ctx; r: MpR; fec?: string }) {
  const v = c.live.view;
  const b = lib(v, r, fec);
  const nh = v.igp[r].find((x) => x.p === fec)?.nh.map((h) => h.nbr) ?? [];
  return (
    <div className="space-y-1">
      <p className="pv-mono text-[12px] text-pv-text">
        {r} · FEC {fec}/32 · local label {labTxt(b.local)}
      </p>
      <STable cols={["From peer", "Label", "Used?"]} rows={b.remote.map((x) => [x.peer, labTxt(x.label), nh.includes(x.peer) ? ["yes — IS-IS next hop", "ok"] : ["kept (liberal retention)", "faint"]])} empty="No remote bindings." />
    </div>
  );
}
function LfibView({ c, r }: { c: Ctx; r: MpR }) {
  const v = c.live.view;
  const es = lfib(v, r);
  return (
    <div className="space-y-1">
      <STable cols={["In label", "FEC", "Out label", "Next hop"]} rows={es.flatMap((e) => e.outs.map((o, k) => [k ? "" : e.inLabel, k ? "" : `${e.fec}/32`, [outTxt(o.out), o.out === "Unlabelled" ? "bad" : o.out === "Pop" ? "hi" : undefined], `${o.nh.nbr} (${ifName(c.vendor, o.nh.ifn)})`] as (string | number | [string, "bad" | "hi" | undefined])[]))} empty={`${r} has no LFIB entries${s0(c, r)}.`} />
      {(r === "PE1" || r === "PE2") && (
        <p className="text-[12px] text-pv-text-muted">
          Ingress (FTN) for the BGP next hop {r === "PE1" ? "4.4.4.4" : "1.1.1.1"}: {ftn(v, r, r === "PE1" ? "4.4.4.4" : "1.1.1.1").map((x) => `${x.out === "Pop" ? "no label" : outTxt(x.out)} via ${x.nh.nbr}`).join(", ") || (c.s.os === "junos" ? "none — no LDP route in inet.3" : "none")}
        </p>
      )}
    </div>
  );
}
const s0 = (c: Ctx, r: MpR) => (!c.s.cfg[r].ldpOn ? " (LDP is off)" : "");
function Routes({ c, r }: { c: Ctx; r: MpR }) {
  const v = c.live.view;
  const far: MpCe | undefined = r === "PE1" ? "CE2" : r === "PE2" ? "CE1" : undefined;
  const b = far ? bgpRoute(c.s, r, CE_IP[far]) : undefined;
  return (
    <STable
      cols={["Prefix", "Source", "Metric", "Next hop"]}
      rows={[
        ...(far ? [[`${CE_NET[far].net}/24`, b ? ["BGP (iBGP)", "hi"] : ["BGP — next hop unreachable", "bad"], "—", b ? `${b.nh} (recursive)` : "—"]] : []),
        ...v.igp[r].filter((x) => x.len === 32).map((x) => [`${x.p}/32`, "IS-IS L2", x.metric, x.nh.map((h) => h.nbr).join(" + ")]),
      ] as (string | number | [string, "hi" | "bad"])[][]}
    />
  );
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
            {t.kind === "ce" ? `CE1 → ${t.dst} (${t.size} bytes)` : t.kind === "lsp" ? `LSP ping ${t.dst}/32 from ${t.from}` : `${t.kind === "trace" ? "traceroute" : "ping"} ${t.dst} from ${t.from}`}: <span className={t.ok ? "text-pv-success" : "text-pv-danger"}>{t.ok ? "success" : "failed"}</span>
          </p>
          <p className="pv-mono text-[11.5px] text-pv-text-muted">there: {pathOf(t.fwd)}</p>
          {t.back && <p className="pv-mono text-[11.5px] text-pv-text-muted">back: {pathOf(t.back)}</p>}
          {!t.ok && <p className="text-[11.5px] text-pv-warning">{spText(c.vendor, (t.fwd.result === "ok" ? t.back?.why : t.fwd.why) ?? (t.fwd.result === "ok" ? `the reply failed at ${t.back?.at}` : `stopped at ${t.fwd.at}`))}</p>}
        </div>
      ))}
    </div>
  );
}
function Shim({ c }: { c: Ctx }) {
  const t = [...c.s.tests].reverse().find((x) => x.kind === "ce");
  const h = t?.fwd.hops.find((x) => x.op === "push");
  if (!t || !h || !c.done) return <p className="text-[12px] text-pv-text-faint">Run the test to see the label on the wire.</p>;
  return (
    <STable
      cols={["Field", "Bits", `On PE1 → ${t.fwd.hops[t.fwd.hops.indexOf(h) + 1]?.dev}`]}
      rows={[
        ["Label", "20", h.labels[0]],
        ["Traffic Class (TC)", "3", "0"],
        ["Bottom of stack (S)", "1", "1 — the only label"],
        ["TTL", "8", "63 (copied from the IP TTL, minus one)"],
        ["Then", "", "the unchanged IP packet 10.1.1.10 → 10.2.2.20"],
      ]}
    />
  );
}
function IgpView({ c, r }: { c: Ctx; r: MpR }) {
  const rt = c.live.view.igp[r].find((x) => x.p === "4.4.4.4");
  return (
    <div className="space-y-1 text-[12.5px]">
      <p className="text-pv-text">
        {r} → 4.4.4.4: {rt ? `metric ${rt.metric} via ${rt.nh.map((h) => h.nbr).join(" + ")}` : "no route"}
      </p>
      <STable cols={["Link", "Metric advertised", "Why"]} rows={MP_LINKS.filter((l) => l.id !== "P1-P3").map((l) => {
        const syncA = c.s.cfg[l.a].ifs[l.ai]!.sync;
        const up = sessionUp(c.live.view, l.a, l.b) && !!c.live.view.hello[`${l.a}|${l.ai}`];
        const max = syncA && !up;
        return [l.id, max ? ["16777214 (max)", "warn"] : c.s.cfg[l.a].ifs[l.ai]!.metric, max ? "LDP–IGP sync: LDP not operational on this link" : syncA ? "sync on, LDP ready" : ""] as (string | number | [string, "warn"])[];
      })} />
    </div>
  );
}
function Ladder({ c }: { c: Ctx }) {
  if (c.busy) return <p className="text-[12px] text-pv-text-faint">The ladder fills in when the runs have finished.</p>;
  return (
    <ol className="space-y-1">
      {mpLadder(c.s).map((r, i) => (
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
function RoutesCompare({ c }: { c: Ctx }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div>
        <p className="mb-1 text-[11.5px] font-semibold text-pv-text">PE1 (runs BGP)</p>
        <Routes c={c} r="PE1" />
      </div>
      <div>
        <p className="mb-1 text-[11.5px] font-semibold text-pv-text">P1 (core: IS-IS only)</p>
        <Routes c={c} r="P1" />
      </div>
    </div>
  );
}

function evidence(key: string, c: Ctx): ReactNode {
  const [k, arg] = key.split(":");
  const card = (title: string, body: ReactNode) => <Card title={title}>{body}</Card>;
  switch (k) {
    case "routes":
      return card("Who knows 10.2.2.0/24?", <RoutesCompare c={c} />);
    case "path":
      return card("What the traffic did", <PathView c={c} />);
    case "sessions":
      return card("LDP on every core link", <SessionTable c={c} />);
    case "disc":
      return card(`${arg}'s LDP discovery and sessions`, <SessionTable c={c} only={arg as MpR} />);
    case "chain":
      return card("The labels for 4.4.4.4/32 along the path", <Chain c={c} />);
    case "bindings":
      return card(`${arg}'s LIB for 4.4.4.4/32`, <Bindings c={c} r={arg as MpR} />);
    case "lfib":
      return card(`${arg}'s LFIB`, <LfibView c={c} r={arg as MpR} />);
    case "shim":
      return card("The MPLS shim header", <Shim c={c} />);
    case "igp":
      return card(`${arg}'s IS-IS view`, <IgpView c={c} r={arg as MpR} />);
    case "ladder":
      return card("The evidence ladder, read from the network", <Ladder c={c} />);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Device windows
// ---------------------------------------------------------------------------------------------------------------
function cfgDiff(r: MpR, a: MpRtr, b: MpRtr): string {
  const out: string[] = [];
  if (a.ldpOn !== b.ldpOn) out.push(b.ldpOn ? "LDP process configured" : "LDP process removed");
  if (a.explicitNull !== b.explicitNull) out.push(b.explicitNull ? "explicit-null advertised" : "implicit-null advertised");
  if (a.lo !== b.lo) out.push(b.lo ? "Loopback0 added to IS-IS" : "Loopback0 removed from IS-IS");
  for (const i of mpIfs(r)) {
    const x = a.ifs[i.ifn]!;
    const y = b.ifs[i.ifn]!;
    if (x.isis !== y.isis) out.push(`${i.ifn} ${y.isis ? "added to" : "removed from"} IS-IS`);
    if (x.ldp !== y.ldp) out.push(`${i.ifn} LDP ${y.ldp ? "enabled" : "removed"}`);
    if (x.mplsIf !== y.mplsIf) out.push(`${i.ifn} protocols mpls ${y.mplsIf ? "added" : "removed"}`);
    if (x.fam !== y.fam) out.push(`${i.ifn} family mpls ${y.fam ? "added" : "removed"}`);
    if (x.sync !== y.sync) out.push(`${i.ifn} LDP-IGP sync ${y.sync ? "on" : "off"}`);
    if (x.metric !== y.metric) out.push(`${i.ifn} metric ${x.metric} → ${y.metric}`);
    if (x.mtu !== y.mtu) out.push(`${i.ifn} MTU ${x.mtu} → ${y.mtu}`);
    if (x.shut !== y.shut) out.push(`${i.ifn} ${y.shut ? "shut down" : "enabled"}`);
  }
  return out.join(", ") || "no change";
}
function devCli(c: Ctx, r: MpR): SpDevCli<MpRtr> {
  return {
    host: r,
    running: c.s.cfg[r],
    hist: c.s.hist[r],
    cand: c.cli.cand[r] as MpRtr | undefined,
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
function RouterUI({ c, r }: { c: Ctx; r: MpR }) {
  const [tab, setTab] = useState<"router" | "ldp" | "lfib" | "routes" | "term" | "log">("router");
  const [fec, setFec] = useState("4.4.4.4");
  const s = c.s;
  const cfg = s.cfg[r];
  const change = (f: (x: MpRtr) => void) => {
    const n = spClone(cfg);
    f(n);
    c.act({ type: "cfg", dev: r, cfg: n, text: `${cfgDiff(r, cfg, n)} (from ${r}'s window)` });
  };
  const api: MpCliApi = { s, act: c.act, dev: devCli(c, r) };
  return (
    <div>
      <Tabs tabs={[["router", "Router"], ["ldp", "LDP"], ["lfib", "LFIB"], ["routes", "Routes"], ["term", "Console"], ["log", "Log"]]} cur={tab} set={setTab} />
      <div className="space-y-2 p-3">
        {tab === "router" && (
          <>
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Kv k="LDP" v={cfg.ldpOn ? `on · router ID ${MP_LO[r]}` : "OFF"} tone={cfg.ldpOn ? undefined : "bad"} />
              <Kv k="Own loopback advertised as" v={!cfg.ldpOn ? "—" : cfg.explicitNull ? "explicit-null (0)" : "implicit-null (3)"} />
              <Kv k="Loopback0 in IS-IS" v={cfg.lo ? "yes" : "NO"} tone={cfg.lo ? undefined : "warn"} />
              <Kv k="Label control" v={s.os === "xr" ? "independent (IOS XR)" : "ordered (Junos)"} />
            </div>
            <div className="max-w-full overflow-x-auto">
              <table className="w-full min-w-max text-left text-[12px]">
                <thead className="text-pv-text-faint">
                  <tr>
                    {["Interface", "Peer", "IS-IS", "Metric", "LDP", "Sync", "MTU", "Session"].map((h) => (
                      <th key={h} className="px-1">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mpIfs(r).map((i) => {
                    const f = cfg.ifs[i.ifn]!;
                    const up = sessionUp(s.view, r, i.peer) && !!s.view.hello[`${r}|${i.ifn}`];
                    return (
                      <tr key={i.ifn} className="border-t border-pv-border/40">
                        <td className="px-1 py-0.5 pv-mono text-pv-text">{ifName(c.vendor, i.ifn)}</td>
                        <td className="px-1 text-pv-text-muted">{i.peer}</td>
                        <td className="px-1">
                          <input type="checkbox" aria-label={`IS-IS on ${i.ifn}`} checked={f.isis} disabled={c.busy} onChange={(e) => change((x) => void (x.ifs[i.ifn]!.isis = e.target.checked))} />
                        </td>
                        <td className="px-1">
                          <select aria-label={`metric ${i.ifn}`} className={sel} value={f.metric} disabled={c.busy || !f.isis} onChange={(e) => change((x) => void (x.ifs[i.ifn]!.metric = +e.target.value))}>
                            {[...new Set([10, 20, 50, 100, f.metric])].sort((a, b) => a - b).map((m) => (
                              <option key={m}>{m}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-1">
                          <input type="checkbox" aria-label={`LDP on ${i.ifn}`} checked={ldpActive(s.cfg, r, i.ifn as IfName) || (f.ldp && f.mplsIf && f.fam)} disabled={c.busy} onChange={(e) => change((x) => void Object.assign(x.ifs[i.ifn]!, { ldp: e.target.checked, mplsIf: e.target.checked, fam: e.target.checked }))} />
                        </td>
                        <td className="px-1">
                          <input type="checkbox" aria-label={`LDP-IGP sync on ${i.ifn}`} checked={f.sync} disabled={c.busy} onChange={(e) => change((x) => void (x.ifs[i.ifn]!.sync = e.target.checked))} />
                        </td>
                        <td className="px-1">
                          <select aria-label={`MTU ${i.ifn}`} className={sel} value={f.mtu} disabled={c.busy} onChange={(e) => change((x) => void (x.ifs[i.ifn]!.mtu = +e.target.value))}>
                            {[...new Set([1514, 9216, f.mtu])].map((m) => (
                              <option key={m}>{m}</option>
                            ))}
                          </select>
                        </td>
                        <td className={clsx("px-1", up ? "text-pv-success" : "text-pv-text-faint")}>{up ? "Operational" : s.view.hello[`${r}|${i.ifn}`] ? "discovery only" : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2">
              <Pill onClick={() => change((x) => void (x.ldpOn = !x.ldpOn))} disabled={c.busy}>
                {cfg.ldpOn ? "Remove LDP from this router" : "Enable LDP on this router"}
              </Pill>
              <Pill onClick={() => change((x) => void (x.explicitNull = !x.explicitNull))} disabled={c.busy || !cfg.ldpOn}>
                {cfg.explicitNull ? "Advertise implicit-null" : "Advertise explicit-null"}
              </Pill>
            </div>
            <p className="text-[11.5px] text-pv-text-faint">The LDP checkbox sets everything the OS needs (Junos: protocols ldp, protocols mpls and family mpls). Changes here are committed at once; the Console works with a candidate and commit.</p>
          </>
        )}
        {tab === "ldp" && (
          <>
            <SessionTable c={c} only={r} />
            <div className="flex flex-wrap items-center gap-1 text-[12px]">
              <span className="text-pv-text-faint">FEC:</span>
              {MP_ROUTERS.map((x) => (
                <button key={x} type="button" aria-pressed={fec === MP_LO[x]} onClick={() => setFec(MP_LO[x])} className={clsx("rounded px-1.5 py-0.5 pv-mono", fec === MP_LO[x] ? "bg-pv-cyan/15 text-pv-text" : "text-pv-text-muted")}>
                  {MP_LO[x]}
                </button>
              ))}
            </div>
            <Bindings c={c} r={r} fec={fec} />
          </>
        )}
        {tab === "lfib" && <LfibView c={c} r={r} />}
        {tab === "routes" && <Routes c={c} r={r} />}
        {tab === "term" && <SpConsole c={c.cli} sets={mpSets(api, r)} os={c.vendor === "cisco" ? "iosxr" : "junos"} host={r} vendor={c.vendor} setVendor={c.setVendor} pipeCtx={c.vendor === "juniper" ? mpPipe(api, r) : undefined} />}
        {tab === "log" && (
          <ul className="space-y-0.5">
            {s.sys.filter((x) => x.dev === r).slice(-30).reverse().map((x, i) => (
              <li key={i} className="pv-mono text-[11.5px] text-pv-text-muted">
                {spStamp(x.t).hms} {x.kind === "commit" ? "configuration committed" : x.kind === "ldp-up" ? `LDP session to ${x.nbr} up` : x.kind === "ldp-down" ? `LDP session to ${x.nbr} down (${x.why})` : x.kind === "disc" ? `LDP discovery with ${x.nbr}, no session (${x.why})` : `IS-IS adjacency to ${x.nbr} ${x.kind === "isis-up" ? "up" : "down"}`}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
function CeUI({ c, ce }: { c: Ctx; ce: MpCe }) {
  return (
    <div className="space-y-2 p-3">
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Kv k="Address" v={`${CE_IP[ce]}/24`} />
        <Kv k="Default gateway" v={`${CE_NET[ce].peIp} (${CE_NET[ce].pe})`} />
      </div>
      <p className="text-[12px] text-pv-text-muted">A customer host: it knows nothing about MPLS. Try ping -c 3 {ce === "CE1" ? CE_IP.CE2 : CE_IP.CE1}, a 1500-byte ping with -M do -s 1472, and traceroute.</p>
      <SpConsole c={c.cli} sets={{ cisco: ceSet({ s: c.s, act: c.act }, ce), juniper: ceSet({ s: c.s, act: c.act }, ce) }} os="linux" host={ce} vendor={c.vendor} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Tools, composer
// ---------------------------------------------------------------------------------------------------------------
function RouterPick({ v, set }: { v: MpR; set: (r: MpR) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {MP_ROUTERS.map((r) => (
        <button key={r} type="button" aria-pressed={v === r} onClick={() => set(r)} className={clsx("rounded-md px-2 py-0.5 text-[11.5px] font-semibold", v === r ? "bg-pv-cyan/15 text-pv-text" : "text-pv-text-muted hover:text-pv-text")}>
          {r}
        </button>
      ))}
    </div>
  );
}
function PickTool({ c, render }: { c: Ctx; render: (r: MpR) => ReactNode }) {
  const [r, setR] = useState<MpR>("PE1");
  return (
    <div className="space-y-2">
      <RouterPick v={r} set={setR} />
      {render(r)}
      {c.snap && <p className="text-[11px] text-pv-text-faint">As of the step the topology is showing.</p>}
    </div>
  );
}
function LabelsTool({ c }: { c: Ctx }) {
  const v = c.live.view;
  return (
    <div className="space-y-2">
      <STable cols={["Router", ...MP_ROUTERS.map((r) => MP_LO[r])]} rows={MP_ROUTERS.map((r) => [r, ...MP_ROUTERS.map((x) => [labTxt(v.local[r][MP_LO[x]]), v.local[r][MP_LO[x]] === undefined ? "faint" : undefined] as [string, "faint" | undefined])])} />
      <p className="text-[11px] text-pv-text-faint">Each router&apos;s own (local) label for each loopback FEC. {c.s.os === "junos" ? "Junos (ordered control): a label exists only once one arrived from downstream." : "IOS XR (independent control): every FEC in the routing table gets a label at once."}</p>
    </div>
  );
}
function CounterTool({ c }: { c: Ctx }) {
  return (
    <div className="space-y-2">
      <STable cols={["Interface", "In", "Out", "Labeled out", "MTU drops", "No route"]} rows={Object.entries(c.s.ctr).map(([k, x]) => [spText(c.vendor, k), x.pktIn, x.pktOut, x.labeledOut, [x.mtuDrops, x.mtuDrops ? "bad" : "faint"], [x.noRoute, x.noRoute ? "bad" : "faint"]])} />
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
  const [from, setFrom] = useState<MpR>("PE1");
  const [fec, setFec] = useState("4.4.4.4");
  return (
    <div className="space-y-2 rounded-xl border border-pv-border p-2">
      <p className="text-[12px] font-semibold text-pv-text">Customer traffic</p>
      <div className="flex flex-wrap gap-1.5">
        <Pill onClick={() => c.act({ type: "test", kind: "ce", from: "CE1", dst: CE_IP.CE2, size: 100 })} disabled={c.busy} tone="primary">
          ping CE1 → CE2
        </Pill>
        <Pill onClick={() => c.act({ type: "test", kind: "ce", from: "CE1", dst: CE_IP.CE2, size: 1500 })} disabled={c.busy}>
          1500-byte ping (DF)
        </Pill>
      </div>
      <p className="text-[12px] font-semibold text-pv-text">Label switched paths</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <select aria-label="From" className={sel} value={from} onChange={(e) => setFrom(e.target.value as MpR)}>
          {MP_ROUTERS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <span className="text-pv-text-faint">→ FEC</span>
        <select aria-label="FEC" className={sel} value={fec} onChange={(e) => setFec(e.target.value)}>
          {MP_ROUTERS.filter((r) => r !== from).map((r) => (
            <option key={r} value={MP_LO[r]}>
              {MP_LO[r]}/32 ({r})
            </option>
          ))}
        </select>
        <Pill onClick={() => c.act({ type: "test", kind: "lsp", from, dst: fec === MP_LO[from] ? "4.4.4.4" : fec })} disabled={c.busy}>
          LSP ping
        </Pill>
        <Pill onClick={() => c.act({ type: "test", kind: "ping", from, dst: fec === MP_LO[from] ? "4.4.4.4" : fec })} disabled={c.busy}>
          IP ping
        </Pill>
      </div>
      <p className="text-[12px] font-semibold text-pv-text">Links</p>
      <div className="flex flex-wrap gap-1">
        {MP_LINKS.map((l) => (
          <button key={l.id} type="button" disabled={c.busy} onClick={() => c.act({ type: "link", link: l.id, up: !c.s.phys[l.id] })} className={clsx("rounded-md border px-2 py-0.5 text-[11.5px] font-semibold disabled:opacity-40", c.s.phys[l.id] ? "border-pv-border text-pv-text-muted hover:text-pv-text" : "border-pv-danger/60 text-pv-danger")}>
            {c.s.phys[l.id] ? `✂ ${l.id}` : `↺ ${l.id}`}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Pill onClick={() => c.act({ type: "wipe-pe1" })} disabled={c.busy || !!c.s.wiped} tone="danger">
          Wipe PE1&apos;s LDP
        </Pill>
        <span className="text-[11.5px] text-pv-text-faint">for challenge 6</span>
      </div>
    </div>
  );
}

const SPEC: SpLabSpec<MpState, MpAction, MpSnap> = {
  title: "MPLS + LDP Lab",
  note: () => "CE1 · PE1 · P1–P4 · PE2 · CE2",
  fresh: (seq, vendor) => createMpNet(seq, vendor === "juniper" ? "junos" : "xr"),
  vendorAction: (v) => ({ type: "os", os: v === "juniper" ? "junos" : "xr" }),
  apply: mpApply,
  snapOf: (s) => ({ view: s.view }),
  ticketAction: (id) => ({ type: "ticket", id: id as MpTicketId }),
  levels: MP_LEVELS,
  gate: {
    title: "You can follow a customer packet through an MPLS core",
    points: [
      "The core runs no BGP: only the PEs know customer prefixes. Labels let the core forward customer traffic toward the BGP next hop without ever routing on the customer address.",
      "LDP Hellos discover neighbors on each link; the session is TCP between loopbacks, so it needs IGP routes to them.",
      "Each router chooses its own label per FEC and advertises it upstream; the egress asks for implicit-null (pop one hop early) or explicit-null.",
      "PUSH at the ingress PE, SWAP in the core, POP at the penultimate hop. The LFIB uses the label from the IGP next hop; the others wait in the LIB.",
      "When LDP and the IGP disagree, labeled traffic breaks while IP still works — LSP ping and LDP–IGP synchronization exist for exactly that.",
    ],
    more: "The engineering workspace gives you every router in its own window (LDP sessions and bindings, the LFIB, routes, an IOS XR / Junos console with commit), the CEs with a shell, customer and LSP tests, link failures, six challenges and five tickets. Switch between IOS XR and Junos: label control (independent vs ordered) and label numbers change with the OS.",
  },
  stage,
  footer: (c) => {
    const f = ftn(c.s.view, "PE1", "4.4.4.4");
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
        <span>
          PE1 → 4.4.4.4: <b className="pv-mono text-pv-text">{f.map((x) => `${x.out === "Pop" ? "no label" : outTxt(x.out)} via ${x.nh.nbr}`).join(", ") || "no LSP"}</b>
        </span>
        <span>
          label control: <b className="text-pv-text">{c.s.os === "xr" ? "independent (IOS XR)" : "ordered (Junos)"}</b>
        </span>
        <span className="text-pv-text-faint">badges: each router&apos;s own label for 4.4.4.4 · links: metric · LDP / IS-IS only</span>
      </div>
    );
  },
  devices: ["CE1", "PE1", "P1", "P2", "P3", "P4", "PE2", "CE2"],
  device: (id, c) => ({ label: id, icon: role(id as MpDev), tone: TONE[role(id as MpDev)], sub: isCe(id) ? `${CE_IP[id]} · Linux` : `${MP_LO[id as MpR]} · ${c.vendor === "cisco" ? "IOS XR" : "Junos"} view` }),
  openFrom: 1,
  window: (id, c) => (isCe(id) ? <CeUI c={c} ce={id} /> : <RouterUI c={c} r={id as MpR} />),
  tools: [
    { id: "sess", label: "Sessions", render: (c) => <SessionTable c={c} /> },
    { id: "labels", label: "Labels", render: (c) => <LabelsTool c={c} /> },
    { id: "lfib", label: "LFIB", render: (c) => <PickTool c={c} render={(r) => <LfibView c={c} r={r} />} /> },
    { id: "lib", label: "LIB", render: (c) => <PickTool c={c} render={(r) => <Bindings c={c} r={r} />} /> },
    { id: "routes", label: "Routes", render: (c) => <PickTool c={c} render={(r) => <Routes c={c} r={r} />} /> },
    { id: "ctr", label: "Counters", render: (c) => <CounterTool c={c} /> },
    { id: "log", label: "Log", render: (c) => <LogTool c={c} /> },
  ],
  toolsLabel: { learn: "What the routers know", eng: "Tools" },
  evidence,
  composer: (c) => <Composer c={c} />,
  investigate: [
    "Compare show mpls forwarding (IOS XR) with show route table mpls.0 (Junos) on P1: same labels? Switch the OS view and look again.",
    "Remove LDP from one end of P1–P2 and run an ordinary ping to 4.4.4.4, then an LSP ping. Which one notices?",
    "Fail P1–P2 and read PE1's LIB: which label was waiting there all along?",
    "Turn on explicit-null on PE2 and traceroute from PE1 to 10.2.2.20: what label does PE2 receive?",
    "In the Junos view, break LDP on P1–P2 and look for PE1's route to 10.2.2.0/24 — then try show route 10.2.2.0/24 hidden.",
  ],
  challenges: MP_CHALLENGES,
  tickets: MP_TICKETS.map((t) => ({ id: t.id, title: t.title, report: t.report, reproLabel: t.reproLabel, repro: t.repro })),
  ticketIntro: "Users report symptoms, not causes. Each ticket is this core after a normal morning, with one real thing wrong. Reproduce it, walk the evidence (IGP, LDP sessions, bindings, LFIB, LSP ping, MTU), name the cause, fix it on the router and prove it with fresh customer traffic.",
  reproHint: "Watch where the packet loses its label — or stops.",
  fixHint: "Fix it on the router (its window, or its console — commit to apply), check the LDP session and the LFIB, then run the customer test again. An accepted command isn't a repaired LSP.",
  causes: MP_CAUSES,
  feedback: mpCauseFeedback,
  proofs: mpProofs,
  ladder: (s) => mpLadder(s),
  runCard: (c) => (
    <Card title="Result">
      <PathView c={c} />
    </Card>
  ),
  text: spText,
};

export function MplsLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SpLabWorkspace spec={SPEC} open={open} onClose={onClose} />;
}
