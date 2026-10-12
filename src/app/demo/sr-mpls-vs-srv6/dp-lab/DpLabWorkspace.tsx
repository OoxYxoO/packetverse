"use client";

import { useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { SpLabWorkspace, type SpCtx, type SpLabSpec } from "@/components/sp-lab/SpLabWorkspace";
import { SpStage, type SpPath, type SpStageLink, type SpStageNode } from "@/components/sp-lab/SpStage";
import { SpConsole } from "@/components/sp-lab/SpDesk";
import { Card, Kv, Pill, STable, Tabs } from "@/components/sp-lab/SpUi";
import { spClone, spStamp, type SpMoment } from "@/components/sp-lab/spKit";
import type { SpDevCli } from "@/components/sp-lab/spCli";
import { spText, xrIf } from "@/components/sp-lab/spNames";
import type { TopoView } from "@/components/presentation/Visuals";
import {
  D_CAUSES,
  D_LINKS,
  D_N,
  D_ROUTERS,
  D_TICKETS,
  LO4,
  VPN_LABEL,
  createDNet,
  dApply,
  dCauseFeedback,
  dIfs,
  dLadder,
  dProofs,
  dView,
  dWalk,
  locOf,
  lossText,
  nodeLbl,
  spCloneCfg,
  type DAction,
  type DCfg,
  type DR,
  type DRtr,
  type DSnap,
  type DState,
  type DTicketId,
  type IfName,
} from "@/lib/sim-engine/scenarios/dpNet";
import { dpSets, type DpCliApi } from "./dpCli";
import { DP_LEVELS } from "./dpLearn";
import { DP_CHALLENGES } from "./dpPractice";

/**
 * SR-MPLS vs SRv6 Lab — the guided lesson's network (PE1, P1–P4, PE2) on IOS XR running both Segment Routing data
 * planes at once: VPN CUST-A rides SR-MPLS (VPN label) or SRv6 (End.DT4) depending on PE2's VRF; P1 protects the P1–P2
 * link with TI-LFA in both planes.
 *   LEARN                  6 levels (dpLearn)
 *   ENGINEERING WORKSPACE  Investigate (pings and P1–P2 drills of 100 or 1460 bytes; the two encodings compared; router
 *                          windows with SR-MPLS/SRv6 state, labels, SIDs, MTUs and IOS XR consoles) · Challenges (five)
 *                          · Troubleshoot (five tickets)
 * One model (dpNet.ts) produces every label, SID, header, byte count, repair and result.
 */

type Ctx = SpCtx<DState, DAction, DSnap>;
type Node = DR | "CE1" | "CE2";
const POS: Record<Node, { x: number; y: number; cx: number; cy: number }> = {
  CE1: { x: 4, y: 48, cx: 4, cy: 35 },
  PE1: { x: 17, y: 48, cx: 17, cy: 35 },
  P1: { x: 33, y: 48, cx: 33, cy: 35 },
  P2: { x: 57, y: 20, cx: 57, cy: 7 },
  PE2: { x: 82, y: 48, cx: 82, cy: 35 },
  P3: { x: 45, y: 80, cx: 45, cy: 93 },
  P4: { x: 67, y: 80, cx: 67, cy: 93 },
  CE2: { x: 96, y: 48, cx: 96, cy: 35 },
};
const plane = (c: DCfg) => (c.PE2.vrfSrv6 ? "SRv6" : "SR-MPLS");
const short = (x: string) => x.replace(/2001:db8:1[01]0:/g, "…:");

function lastTest(c: Ctx) {
  return c.s.tests[c.s.tests.length - 1];
}
function stage(c: Ctx, p: { moment?: SpMoment<DSnap>; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) {
  const s = c.s;
  const nodes: SpStageNode[] = (Object.keys(POS) as Node[]).map((d) => {
    if (d === "CE1" || d === "CE2") return { id: d, label: d, role: "CE", tone: "#34d399", sub: d === "CE1" ? "10.10.1.0/24" : "10.20.1.0/24", ...POS[d] };
    const k = s.cfg[d];
    const both = k.mpls && k.isisLoc;
    return { id: d, label: d, role: d.startsWith("PE") ? "PE" : "P", tone: both ? "#22d3ee" : "#fbbf24", sub: `${k.mpls ? (k.sid ? nodeLbl(d) : "no SID") : "no MPLS"} · ${k.isisLoc ? "SRv6" : "no SRv6"}`, ...POS[d] };
  });
  const t = lastTest(c);
  const cutShown = !!t?.cut && !p.moment && t.cfgSeq === s.cfgSeq;
  const links: SpStageLink[] = [
    { id: "CE1-PE1", a: "CE1", b: "PE1", state: "up" },
    { id: "PE2-CE2", a: "PE2", b: "CE2", state: "up" },
    ...D_LINKS.map((l) => {
      const small = Math.min(s.cfg[l.a].mtu[l.ai] ?? 9216, s.cfg[l.b].mtu[l.bi] ?? 9216);
      return { id: l.id, a: l.a, b: l.b, state: (l.id === "P1-P2" && (cutShown || p.moment?.lines.some((x) => /P1–P2/.test(x.text))) ? "down" : "up") as SpStageLink["state"], label: [l.metric !== 10 ? `metric ${l.metric}` : "", small < 9216 ? `mtu ${small}` : ""].filter(Boolean).join(" · ") };
    }),
  ];
  const v = c.live.view;
  const views: Record<string, TopoView> = { PE1: { badge: { text: v.svc.enc === "mpls" ? "SR-MPLS" : "SRv6", tone: v.svc.usable && v.svc.transport !== false ? "info" : "warn" } } };
  const paths: SpPath[] = [];
  if (!p.moment && t && t.cfgSeq === s.cfgSeq) paths.push({ id: "w", nodes: t.walk.path, color: t.walk.ok ? (t.enc === "mpls" ? "#22d3ee" : "#a78bfa") : "#f87171", offset: 0 });
  return <SpStage nodes={nodes} links={links} paths={paths} views={views} moment={p.moment} momentKey={p.momentKey} compact={p.compact} onNode={p.onNode} selected={p.selected} regions={[{ x: 10, y: 4, w: 79, h: 92, label: "IS-IS CORE · SR-MPLS + SRv6", color: "#22d3ee" }]} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------------------------
type Cell = string | [string, "ok" | "bad" | "warn"];
function Planes({ c }: { c: Ctx }) {
  const s = c.s;
  const rows = D_ROUTERS.map((r) => {
    const k = s.cfg[r];
    return [r, k.mpls ? "on" : ["off", "bad"], k.mpls && k.sid ? `index ${D_N[r]} → ${nodeLbl(r)}` : ["none", "warn"], k.isisLoc ? `${locOf(r)}/64` : ["not advertised", "bad"], r === "PE2" ? (k.vrfSrv6 ? "End.DT4 (SRv6)" : `VPN label ${VPN_LABEL}`) : r === "PE1" ? "ingress" : "—"] as Cell[];
  });
  return <STable cols={["Router", "SR-MPLS", "Prefix-SID → label", "SRv6 locator in IS-IS", "CUST-A service"]} rows={rows} />;
}
/** The same CUST-A packet over each plane, computed by walking the model with PE2's choice flipped. */
function Compare({ c }: { c: Ctx }) {
  const row = (srv6: boolean): Cell[] => {
    const cfg = spCloneCfg(c.s.cfg);
    cfg.PE2.vrfSrv6 = srv6;
    const v = dView(cfg);
    const w = dWalk(cfg, v, 100);
    const d = dWalk(cfg, v, 100, true);
    const cur = !!c.s.cfg.PE2.vrfSrv6 === srv6;
    return [`${srv6 ? "SRv6" : "SR-MPLS"}${cur ? " (in use)" : ""}`, w.hops[1]?.hdr && !w.hops[1].drop ? (srv6 ? short(w.hops[1].hdr) : w.hops[1].hdr) : ["none", "bad"], w.ok ? `${w.overhead} B` : ["—", "bad"], d.ok ? `+${d.peakOverhead - d.overhead} B → ${d.peakOverhead} B` : [d.why?.includes("convergence") ? "no backup" : "dropped", "bad"], w.ok ? ["delivered", "ok"] : [w.why ?? "failed", "bad"]];
  };
  return (
    <div className="space-y-1">
      <STable cols={["Plane", "PE1 pushes", "Overhead", "During P1's repair", "100-byte ping"]} rows={[row(false), row(true)]} />
      <p className="text-[11.5px] text-pv-text-muted">Computed from this network: each row walks the same packet with PE2&apos;s VRF set to that plane. A label costs 4 bytes; an IPv6 header 40.</p>
    </div>
  );
}
function Repair({ c }: { c: Ctx }) {
  const r = c.live.view.repair;
  return (
    <div className="space-y-1 text-[12px]">
      <p className="text-pv-text-muted">
        P1&apos;s TI-LFA backup for PE2 (the P1–P2 cut): <b className="text-pv-text">{r.path.join(" → ")}</b>. {r.pNode}&apos;s own shortest path to {r.qNode} still runs back through P1 — the repair must force {r.pNode} → {r.qNode}.
      </p>
      <STable cols={["Plane", "P1 adds", "Extra bytes"]} rows={[["SR-MPLS", r.labels ? `[${r.labels.join(", ")}] above ${nodeLbl("PE2")}  (${r.pNode} Node SID, ${r.pNode} Adj-SID → ${r.qNode})` : ["none — " + r.mplsWhy, "bad"], r.labels ? "+8 (two labels)" : "—"], ["SRv6", r.sids ? `IPv6 DA ${r.sids[0]}  (${r.pNode} End.X → ${r.qNode})` : ["none — " + r.srv6Why, "bad"], r.sids ? "+40 (outer IPv6, no SRH)" : "—"]] as Cell[][]} />
    </div>
  );
}
function Hops({ c }: { c: Ctx }) {
  const t = lastTest(c);
  if (!t) return <p className="text-[12px] text-pv-text-faint">Send traffic above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The packet appears when the run has finished.</p>;
  const rows = t.walk.hops.map((h) => [h.to && h.at !== h.to ? `${h.at} → ${h.to}` : `at ${h.at}`, h.hdr ? short(h.hdr) : "—", h.bytes ? String(h.bytes) : "—", h.drop ? [h.note, "bad"] : h.repair ? [h.note, "warn"] : h.note] as Cell[]);
  return <STable cols={["Where", "Header", "Bytes", "What happened"]} rows={rows} />;
}
function PathView({ c }: { c: Ctx }) {
  const run = [...c.s.runs].reverse().find((r) => r.kind === "test");
  if (!run) return <p className="text-[12px] text-pv-text-faint">Send traffic above.</p>;
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
  const t = lastTest(c);
  if (!t) return <p className="text-[12px] text-pv-text-faint">Send traffic above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The result appears when the run has finished.</p>;
  return (
    <div className={clsx("rounded-lg border px-2 py-1 text-[12.5px]", t.walk.ok ? "border-pv-success/40" : "border-pv-danger/40")}>
      <p className="font-semibold text-pv-text">
        {t.cut ? "Drill (P1–P2 cut): " : ""}CE1 → CE2, {t.size} bytes over {t.enc === "mpls" ? "SR-MPLS" : "SRv6"}: <span className={t.walk.ok ? "text-pv-success" : "text-pv-danger"}>{t.walk.ok ? "delivered" : "failed"}</span>
      </p>
      <p className="text-[11.5px] text-pv-text-muted">
        path {t.walk.path.join(" → ")} · {t.walk.overhead} B of encapsulation{t.walk.peakOverhead > t.walk.overhead ? `, ${t.walk.peakOverhead} B during the repair` : ""}{t.cut ? ` · traffic lost: ${lossText(t.lossMs)}` : ""}
      </p>
      {t.walk.why && <p className="text-[11.5px] text-pv-warning">{spText(c.vendor, t.walk.why)}</p>}
    </div>
  );
}
function Ladder({ c }: { c: Ctx }) {
  if (c.busy) return <p className="text-[12px] text-pv-text-faint">The ladder fills in when the run has finished.</p>;
  return (
    <ol className="space-y-1">
      {dLadder(c.s).map((r, i) => (
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
    case "planes":
      return card("Both data planes, router by router", <Planes c={c} />);
    case "compare":
      return card("The same packet over each plane, computed from this network", <Compare c={c} />);
    case "repair":
      return card("P1's TI-LFA backup in both planes", <Repair c={c} />);
    case "hops":
      return card("The packet, router by router", <Hops c={c} />);
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
// Router windows
// ---------------------------------------------------------------------------------------------------------------
function cfgDiff(a: DRtr, b: DRtr): string {
  const out: string[] = [];
  if (a.mpls !== b.mpls) out.push(`segment-routing mpls ${b.mpls ? "on" : "off"}`);
  if (a.sid !== b.sid) out.push(`prefix-sid ${b.sid ? "restored" : "removed"}`);
  if (a.isisLoc !== b.isisLoc) out.push(`SRv6 locator ${b.isisLoc ? "advertised" : "withdrawn"} in IS-IS`);
  if (a.vrfSrv6 !== b.vrfSrv6) out.push(`VRF CUST-A over ${b.vrfSrv6 ? "SRv6 (End.DT4)" : "SR-MPLS (VPN label)"}`);
  for (const k of Object.keys(b.mtu) as IfName[]) if (a.mtu[k] !== b.mtu[k]) out.push(`${k} mtu ${b.mtu[k]}`);
  return out.join(", ") || "no change";
}
function devCli(c: Ctx, r: DR): SpDevCli<DRtr> {
  return {
    host: r,
    running: c.s.cfg[r],
    hist: c.s.hist[r],
    cand: c.cli.cand[r] as DRtr | undefined,
    setCand: (x) => c.cli.setCand(r, x),
    xr: c.cli.xr[r] ?? [],
    setXr: (st) => c.cli.setXr(r, st),
    edit: !!c.cli.edit[r],
    setEdit: (b) => c.cli.setEdit(r, b),
    commit: (cfg, how) => c.act({ type: "cfg", dev: r, cfg, text: `${cfgDiff(c.s.cfg[r], cfg)} (${how}, IOS XR)` }),
    ask: c.cli.setQuestion,
  };
}
function Labels({ c, r }: { c: Ctx; r: DR }) {
  const s = c.s;
  if (!s.cfg[r].mpls) return <p className="text-[12px] text-pv-warning">{r} does not run SR-MPLS: no label table.</p>;
  const v = c.live.view;
  const rows = D_ROUTERS.filter((d) => d !== r && s.cfg[d].mpls && s.cfg[d].sid).map((d) => {
    const x = v.rib[r].find((y) => y.dst === d)!;
    const nh = x.nh!.r;
    return [String(nodeLbl(d)), `${LO4(d)}/32`, nh === d ? "Pop" : s.cfg[nh].mpls ? String(nodeLbl(d)) : ["Unlabelled", "bad"], `${xrIf(x.nh!.ifn, true)} → ${nh}`] as Cell[];
  });
  return <STable cols={["Local label", "Prefix", "Outgoing", "Interface"]} rows={rows} />;
}
type Tab = "main" | "labels" | "term" | "log";
function RouterUI({ c, r }: { c: Ctx; r: DR }) {
  const [tab, setTab] = useState<Tab>("main");
  const s = c.s;
  const cfg = s.cfg[r];
  const change = (f: (x: DRtr) => void) => {
    const n = spClone(cfg);
    f(n);
    c.act({ type: "cfg", dev: r, cfg: n, text: `${cfgDiff(cfg, n)} (from ${r}'s window)` });
  };
  const api: DpCliApi = { s, act: c.act, dev: devCli(c, r) };
  return (
    <div>
      <Tabs tabs={[["main", "Data planes"], ["labels", "Labels"], ["term", "Console"], ["log", "Log"]]} cur={tab} set={setTab} />
      <div className="space-y-2 p-3">
        {tab === "main" && (
          <>
            <Card title={`${r} · ${LO4(r)} · locator ${locOf(r)}/64`}>
              <div className="grid gap-x-4 sm:grid-cols-2">
                <Kv k="SR-MPLS (IS-IS ipv4)" v={cfg.mpls ? "on" : "off"} tone={cfg.mpls ? undefined : "warn"} />
                <Kv k="Prefix-SID on Loopback0" v={cfg.sid ? `index ${D_N[r]} (label ${nodeLbl(r)})` : "none"} tone={cfg.sid ? undefined : "warn"} />
                <Kv k="SRv6 locator in IS-IS" v={cfg.isisLoc ? "advertised" : "not advertised"} tone={cfg.isisLoc ? undefined : "warn"} />
                {r === "PE2" && <Kv k="VRF CUST-A service" v={cfg.vrfSrv6 ? "SRv6 End.DT4" : `MPLS VPN label ${VPN_LABEL}`} />}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Pill onClick={() => change((x) => void (x.mpls = !x.mpls))} disabled={c.busy}>
                  {cfg.mpls ? "disable SR-MPLS" : "enable SR-MPLS"}
                </Pill>
                <Pill onClick={() => change((x) => void (x.sid = !x.sid))} disabled={c.busy}>
                  {cfg.sid ? "remove prefix-SID" : "restore prefix-SID"}
                </Pill>
                <Pill onClick={() => change((x) => void (x.isisLoc = !x.isisLoc))} disabled={c.busy}>
                  {cfg.isisLoc ? "withdraw SRv6 locator" : "advertise SRv6 locator"}
                </Pill>
                {r === "PE2" && (
                  <Pill onClick={() => change((x) => void (x.vrfSrv6 = !x.vrfSrv6))} disabled={c.busy} tone="primary">
                    {cfg.vrfSrv6 ? "CUST-A back to SR-MPLS" : "move CUST-A to SRv6"}
                  </Pill>
                )}
              </div>
            </Card>
            <Card title="Interfaces">
              <ul className="space-y-1">
                {dIfs(r).map((i) => (
                  <li key={i.ifn} className="flex flex-wrap items-center gap-1.5 text-[12px]">
                    <span className="pv-mono text-pv-text">{xrIf(i.ifn, true)}</span>
                    <span className="text-pv-text-muted">to {i.peer}</span>
                    <span className={clsx("pv-mono", (cfg.mtu[i.ifn] ?? 9216) < 9216 ? "text-pv-warning" : "text-pv-text-muted")}>mtu {cfg.mtu[i.ifn] ?? 9216}</span>
                    <Pill onClick={() => change((x) => void (x.mtu[i.ifn] = (x.mtu[i.ifn] ?? 9216) < 9216 ? 9216 : 1514))} disabled={c.busy}>
                      {(cfg.mtu[i.ifn] ?? 9216) < 9216 ? "set 9216" : "set 1514"}
                    </Pill>
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}
        {tab === "labels" && <Labels c={c} r={r} />}
        {tab === "term" && <SpConsole c={c.cli} sets={dpSets(api, r)} os="iosxr" host={r} vendor={c.vendor} setVendor={c.setVendor} />}
        {tab === "log" && (
          <ul className="space-y-0.5">
            {s.sys.filter((x) => x.dev === r).slice(-30).reverse().map((x, i) => (
              <li key={i} className="pv-mono text-[11.5px] text-pv-text-muted">
                {spStamp(x.t).hms} {x.kind === "commit" ? "configuration committed" : `IS-IS ${x.peer} Up`}
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
  return (
    <div className="space-y-2 rounded-xl border border-pv-border p-2">
      <p className="text-[12px] font-semibold text-pv-text">CUST-A traffic, site 1 → site 2 (currently over {plane(c.s.cfg)})</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <Pill onClick={() => c.act({ type: "ping", size: 100 })} disabled={c.busy} tone="primary">
          ping 100 bytes
        </Pill>
        <Pill onClick={() => c.act({ type: "ping", size: 1460 })} disabled={c.busy}>
          ping 1460 bytes
        </Pill>
        <Pill onClick={() => c.act({ type: "drill", size: 100 })} disabled={c.busy}>
          drill P1–P2 cut · 100 B
        </Pill>
        <Pill onClick={() => c.act({ type: "drill", size: 1460 })} disabled={c.busy}>
          drill · 1460 B
        </Pill>
      </div>
      <p className="text-[11.5px] text-pv-text-faint">A drill cuts P1–P2 for one packet: P1 repairs locally (TI-LFA) while every other router still uses its old table. PE2&apos;s window switches CUST-A between the planes.</p>
    </div>
  );
}

const SPEC: SpLabSpec<DState, DAction, DSnap> = {
  title: "SR-MPLS vs SRv6 Lab",
  note: () => "two data planes · one network · IOS XR",
  fresh: (seq) => createDNet(seq),
  vendors: ["cisco"],
  apply: dApply,
  snapOf: (s) => ({ view: s.view }),
  ticketAction: (id) => ({ type: "ticket", id: id as DTicketId }),
  levels: DP_LEVELS,
  gate: {
    title: "You can run and compare both Segment Routing data planes",
    points: [
      "One IGP, two instruction sets: a prefix-SID label per node (SR-MPLS) and a locator per node (SRv6).",
      "SR-MPLS: a label stack, acted on hop by hop — every transit router needs a label entry.",
      "SRv6: one IPv6 destination; transit routers only need an IPv6 route to the owner's locator.",
      "The egress PE decides the plane for a VPN: VPN label or SRv6 service SID. Each plane needs its own reachability.",
      "TI-LFA works in both: labels cost 4 bytes per instruction, SRv6 40 per extra IPv6 header — mind the MTU.",
    ],
    more: "The engineering workspace gives you every router in its own window (SR-MPLS, prefix-SID, SRv6 locator, PE2's VRF plane, MTUs, IOS XR consoles with commit), pings and P1–P2 drills of 100 or 1460 bytes, the two encodings compared from the live network, five challenges and five tickets.",
  },
  stage,
  footer: (c) => {
    const v = c.live.view;
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
        <span>
          CUST-A rides <b className="text-pv-text">{v.svc.enc === "mpls" ? "SR-MPLS" : "SRv6"}</b>
          {v.svc.enc === "mpls" ? ` (VPN label ${VPN_LABEL}${v.svc.transport ? `, transport ${nodeLbl("PE2")}` : ", no transport label"})` : ` (End.DT4 ${short(v.svc.sid!)}${v.svc.usable ? "" : ", unreachable"})`}
        </span>
        <span>
          P1 backup: {v.repair.labels ? `[${v.repair.labels.join(", ")}]` : "no MPLS"} · {v.repair.sids ? short(v.repair.sids[0]) : "no SRv6"}
        </span>
        <span className="text-pv-text-faint">amber node: one plane missing</span>
      </div>
    );
  },
  devices: D_ROUTERS,
  device: (id) => ({ label: id, icon: id.startsWith("PE") ? "PE" : "P", tone: "#22d3ee", sub: `${LO4(id as DR)} · IOS XR` }),
  openFrom: 1,
  window: (id, c) => <RouterUI c={c} r={id as DR} />,
  tools: [
    { id: "planes", label: "Both planes, per router", render: (c) => <Planes c={c} /> },
    { id: "compare", label: "SR-MPLS vs SRv6 encoding", render: (c) => <Compare c={c} /> },
    { id: "repair", label: "P1's TI-LFA backups", render: (c) => <Repair c={c} /> },
    { id: "hops", label: "Packet, router by router", render: (c) => <Hops c={c} /> },
    { id: "path", label: "Last run, step by step", render: (c) => <PathView c={c} /> },
    { id: "log", label: "Log", render: (c) => <LogTool c={c} /> },
  ],
  toolsLabel: { learn: "What the routers know", eng: "Tools" },
  evidence,
  composer: (c) => <Composer c={c} />,
  investigate: [
    "On PE1: show cef vrf CUST-A 10.20.1.10 — which labels does it impose, and which is transport, which service?",
    "On P1: show mpls forwarding labels 16006 — the primary entry and the TI-LFA backup marked (!).",
    "Move CUST-A to SRv6 in PE2's window, then repeat show cef on PE1. What replaced the two labels?",
    "On P2: disable SR-MPLS, then ping over each plane. Which survives, and why?",
    "Drill the P1–P2 cut with 1460 bytes over each plane. How many bytes does each repair add?",
  ],
  challenges: DP_CHALLENGES,
  tickets: D_TICKETS.map((t) => ({ id: t.id, title: t.title, report: t.report, reproLabel: t.reproLabel, repro: t.repro })),
  ticketIntro: "Customers report symptoms after migrations and upgrades. Each ticket is this network after a change with one real thing wrong. Reproduce it, find out which plane CUST-A rides and what that plane needs (labels, locators, a backup, the byte budget), name the cause, fix it, and prove it with fresh traffic.",
  reproHint: "Watch which plane CUST-A uses, where the packet stops and what the header looked like there.",
  fixHint: "Fix it on the router (its window or console — commit to apply), then send fresh traffic of the same kind.",
  causes: D_CAUSES,
  feedback: dCauseFeedback,
  proofs: dProofs,
  ladder: (s) => dLadder(s),
  text: (v, t) => spText(v, t),
  runCard: (c) => (
    <Card title="Result">
      <TestView c={c} />
    </Card>
  ),
};

export function DpLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SpLabWorkspace spec={SPEC} open={open} onClose={onClose} />;
}
