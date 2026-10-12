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
  SV_CAUSES,
  SV_CE,
  SV_CES,
  SV_LINKS,
  SV_LO,
  SV_PES,
  SV_ROUTERS,
  SV_TICKETS,
  SV_VRFS,
  ceHost,
  ceIfIp,
  coreIfs,
  createSvNet,
  locOf,
  peIfIp,
  pfx4,
  pfx6,
  svApply,
  svCauseFeedback,
  svLadder,
  svProofs,
  type Ce,
  type Fam,
  type Pe,
  type SvAction,
  type SvRtr,
  type SvR,
  type SvSnap,
  type SvState,
  type SvTicketId,
  type Vrf,
} from "@/lib/sim-engine/scenarios/svNet";
import { svSets, type SvCliApi } from "./svCli";
import { SV_LEVELS } from "./svLearn";
import { SV_CHALLENGES } from "./svPractice";

/**
 * SRv6 L3VPN Lab — the guided lesson's network on IOS XR, plus a second customer: CUST-A (dual-stack, CE1/CE6 at PE1,
 * CE2/CE3 at PE2) and CUST-B (IPv4, CE4/CE5 with the same addresses as CE1/CE2), RR1 reflecting VPNv4/VPNv6.
 *   LEARN                  6 levels (svLearn)
 *   ENGINEERING WORKSPACE  Investigate (pings between any CE and any address; PE, P, RR1 and CE windows; IOS XR
 *                          consoles) · Challenges (five) · Troubleshoot (five tickets)
 * One model (svNet.ts) produces every VRF, VPN route, SID, session, table and packet.
 */

type Ctx = SpCtx<SvState, SvAction, SvSnap>;
type Node = SvR | Ce;
const POS: Record<Node, { x: number; y: number; cx: number; cy: number }> = {
  CE1: { x: 5, y: 22, cx: 5, cy: 9 },
  CE4: { x: 5, y: 52, cx: 5, cy: 39 },
  CE6: { x: 5, y: 82, cx: 5, cy: 95 },
  PE1: { x: 22, y: 52, cx: 22, cy: 39 },
  P1: { x: 41, y: 52, cx: 41, cy: 65 },
  RR1: { x: 41, y: 18, cx: 41, cy: 5 },
  P2: { x: 60, y: 52, cx: 60, cy: 65 },
  PE2: { x: 78, y: 52, cx: 78, cy: 39 },
  CE2: { x: 95, y: 22, cx: 95, cy: 9 },
  CE3: { x: 95, y: 52, cx: 95, cy: 39 },
  CE5: { x: 95, y: 82, cx: 95, cy: 95 },
};
const VRF_TONE: Record<Vrf, string> = { "CUST-A": "#34d399", "CUST-B": "#fbbf24" };
const role = (d: string) => (d.startsWith("CE") ? "CE" : d.startsWith("PE") ? "PE" : d === "RR1" ? "RR" : "P");
const short = (x: string) => x.replace("2001:db8:100:", "…:");
const DESTS = ["10.20.1.10", "10.20.2.10", "10.10.1.10", "10.10.6.10", "2001:db8:ca:20::a", "2001:db8:ca:30::a", "2001:db8:ca:10::a", "192.168.22.1", "192.168.11.1"];

function stage(c: Ctx, p: { moment?: SpMoment<SvSnap>; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) {
  const s = c.s;
  const v = c.live.view;
  const nodes: SpStageNode[] = (Object.keys(POS) as Node[]).map((d) => ({ id: d, label: d, role: role(d), tone: d.startsWith("CE") ? VRF_TONE[SV_CE[d as Ce].vrf] : d === "RR1" ? "#a78bfa" : "#22d3ee", sub: d.startsWith("CE") ? `${SV_CE[d as Ce].vrf} · ${SV_CE[d as Ce].lan4}0/24` : d === "RR1" ? "route reflector" : SV_LO[d as SvR].replace("2001:db8:", "…"), ...POS[d] }));
  const links: SpStageLink[] = [
    ...SV_CES.map((ce) => ({ id: `${SV_CE[ce].pe}-${ce}`, a: SV_CE[ce].pe, b: ce, state: (s.cfg[SV_CE[ce].pe].ifs[SV_CE[ce].ifn]?.vrf ? "up" : "blocked") as SpStageLink["state"], label: s.cfg[SV_CE[ce].pe].ifs[SV_CE[ce].ifn]?.vrf ?? "no VRF" })),
    ...SV_LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b, state: (v.adj[l.id] ? "up" : "blocked") as SpStageLink["state"], label: l.id === "P1-RR1" ? "iBGP via core" : v.adj[l.id] ? "IPv6 · SRv6" : "down" })),
  ];
  const views: Record<string, TopoView> = {};
  for (const pe of SV_PES) views[pe] = { badge: { text: `${v.imported[pe].filter((x) => x.installed).length} VPN routes`, tone: v.sessions[pe].up ? "info" : "warn" } };
  const paths: SpPath[] = [];
  const t = s.tests[s.tests.length - 1];
  if (!p.moment && t && t.cfgSeq === s.cfgSeq) {
    paths.push({ id: "f", nodes: t.fwd.path, color: t.fwd.ok ? "#a78bfa" : "#f87171", offset: -1 });
    if (t.rev) paths.push({ id: "r", nodes: t.rev.path, color: t.rev.ok ? "#fbbf24" : "#f87171", offset: 1 });
  }
  return <SpStage nodes={nodes} links={links} paths={paths} views={views} moment={p.moment} momentKey={p.momentKey} compact={p.compact} onNode={p.onNode} selected={p.selected} regions={[{ x: 15, y: 30, w: 70, h: 44, label: "IPv6 / SRv6 provider core · AS 65000", color: "#22d3ee" }]} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------------------------
type Cell = string | [string, "ok" | "bad" | "warn"];
function VrfTables({ c, only }: { c: Ctx; only?: Pe }) {
  const v = c.live.view;
  const rows: Cell[][] = [];
  for (const pe of SV_PES.filter((x) => !only || x === only))
    for (const vrf of SV_VRFS)
      for (const fam of ["ipv4", "ipv6"] as Fam[])
        for (const r of v.vrfRib[pe][vrf][fam]) rows.push([pe, vrf, r.pfx, r.kind === "bgp" ? [`BGP → ${r.imp!.route.pe} ${short(r.imp!.route.sid!)}`, "ok"] : r.kind === "static" ? `static → ${r.ce}` : `connected (${r.ce})`]);
  return <STable cols={["PE", "VRF", "Prefix", "Source"]} rows={rows} />;
}
function vpnStatus(c: Ctx, x: { pe: Pe; vrf: Vrf; pfx: string; fam: Fam }): Cell {
  const v = c.live.view;
  const other: Pe = x.pe === "PE1" ? "PE2" : "PE1";
  const imp = v.imported[other].find((y) => y.route.pe === x.pe && y.route.pfx === x.pfx && y.route.vrf === x.vrf);
  if (imp) return imp.installed ? [`${other}: installed in ${imp.vrf}`, "ok"] : [`${other}: not installed — ${imp.why}`, "bad"];
  if (!v.rrTable.some((y) => y.pe === x.pe && y.pfx === x.pfx && y.vrf === x.vrf)) return [`not on RR1 (${x.fam === "ipv4" ? "VPNv4" : "VPNv6"} not negotiated)`, "bad"];
  if (!v.received[other].some((y) => y.pe === x.pe && y.pfx === x.pfx && y.vrf === x.vrf)) return [`${other} doesn't receive it`, "bad"];
  return [`${other}: no VRF imports its RT`, "warn"];
}
function VpnRoutes({ c, only }: { c: Ctx; only?: Pe }) {
  const v = c.live.view;
  const rows: Cell[][] = v.vpn.filter((x) => !only || x.pe === only).map((x) => [`${x.rd}:${x.pfx}`, x.rts.join(" ") || "—", x.sid ? `${short(x.sid)} ${x.behavior}` : ["none", "bad"], vpnStatus(c, x)]);
  return (
    <div className="space-y-1">
      <p className="text-[11.5px] text-pv-text-muted">
        Sessions: {SV_PES.map((p) => `${p}–RR1 ${v.sessions[p].up ? "Established" : "down"} [${[v.sessions[p].vpnv4 ? "VPNv4" : "", v.sessions[p].vpnv6 ? "VPNv6" : ""].filter(Boolean).join(", ") || "no families"}]`).join(" · ")} · next hops: PE loopbacks
      </p>
      <STable cols={["RD:prefix (originated)", "RT", "Service SID", "At the other PE"]} rows={rows} />
    </div>
  );
}
function Sids({ c, only }: { c: Ctx; only?: SvR }) {
  const v = c.live.view;
  const fnOf = (sid: string) => parseInt(sid.split(":")[4] || "0", 16);
  const rows = SV_ROUTERS.filter((r) => (only ? r === only : r === "PE1" || r === "PE2") && locOf(r)).flatMap((r) =>
    v.sids[r].length ? [...v.sids[r]].sort((a, b) => fnOf(a.sid) - fnOf(b.sid)).map((x) => [r, x.sid, x.behavior, x.peer ? `→ ${x.peer}` : x.ce ? `${x.vrf} → ${x.ce}` : x.vrf ? `VRF ${x.vrf}` : "this node"] as Cell[]) : [[r, ["none", "bad"], "—", "—"] as Cell[]],
  );
  return (
    <div className="space-y-1">
      <p className="text-[11.5px] text-pv-text-muted">Locators in the IGP: {SV_ROUTERS.filter((r) => locOf(r)).map((r) => `${r} ${locOf(r)}/64 ${c.s.cfg[r].isisLoc ? "✓" : "✗"}`).join(" · ")}</p>
      <STable cols={["Router", "Local SID", "Behavior", "Context"]} rows={rows} />
    </div>
  );
}
function Headers({ c }: { c: Ctx }) {
  const t = c.s.tests[c.s.tests.length - 1];
  if (!t) return <p className="text-[12px] text-pv-text-faint">Ping above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The headers appear when the run has finished.</p>;
  const mk = (pfx: string, hs: typeof t.fwd.hops) => hs.filter((h) => h.from !== h.to || h.outer).map((h) => [`${pfx}${h.from === h.to ? `at ${h.from}` : `${h.from} → ${h.to}`}`, h.outer ? short(h.outer.da) : "—", `${h.inner.src} → ${h.inner.dst}`] as Cell[]);
  return (
    <div className="space-y-1">
      <p className="text-[11.5px] text-pv-text-muted">
        {t.src} → {t.to}: {t.fwd.sid ? `service SID ${t.fwd.sid} (${t.fwd.behavior})` : "no SRv6 (local or dropped)"}
        {t.rev?.sid ? ` · reply SID ${t.rev.sid} (${t.rev.behavior})` : ""}
      </p>
      <STable cols={["Where", "Outer IPv6 DA", "Customer packet"]} rows={[...mk("", t.fwd.hops), ...mk("reply · ", t.rev?.hops ?? [])]} />
    </div>
  );
}
function PathView({ c }: { c: Ctx }) {
  const run = [...c.s.runs].reverse().find((r) => r.kind === "test");
  if (!run) return <p className="text-[12px] text-pv-text-faint">Ping above.</p>;
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
  if (!t) return <p className="text-[12px] text-pv-text-faint">Ping above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The result appears when the run has finished.</p>;
  return (
    <div className={clsx("rounded-lg border px-2 py-1 text-[12.5px]", t.ok ? "border-pv-success/40" : "border-pv-danger/40")}>
      <p className="font-semibold text-pv-text">
        {t.src} ({t.from}) → {t.to}: <span className={t.ok ? "text-pv-success" : "text-pv-danger"}>{t.ok ? `success — answered by ${t.deliveredTo}` : "failed"}</span>
      </p>
      <p className="text-[11.5px] text-pv-text-muted">
        request {t.fwd.path.join(" → ")}
        {t.fwd.sid ? ` · SID ${t.fwd.sid} (${t.fwd.behavior})` : ""}
        {t.rev ? ` · reply ${t.rev.path.join(" → ")}` : ""}
      </p>
      {t.why && <p className="text-[11.5px] text-pv-warning">{t.why}</p>}
    </div>
  );
}
function Ladder({ c }: { c: Ctx }) {
  if (c.busy) return <p className="text-[12px] text-pv-text-faint">The ladder fills in when the run has finished.</p>;
  return (
    <ol className="space-y-1">
      {svLadder(c.s).map((r, i) => (
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
    case "vrf":
      return card("VRF tables on PE1 and PE2", <VrfTables c={c} />);
    case "routes":
      return card("VPN routes: what each PE advertises, and what the other does with it", <VpnRoutes c={c} />);
    case "sids":
      return card("Local SID tables", <Sids c={c} />);
    case "headers":
      return card("The packet, hop by hop", <Headers c={c} />);
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
// Device windows
// ---------------------------------------------------------------------------------------------------------------
function cfgDiff(a: SvRtr, b: SvRtr): string {
  const out: string[] = [];
  if (a.isisLoc !== b.isisLoc) out.push(`SRv6 locator ${b.isisLoc ? "advertised" : "withdrawn"} in IS-IS`);
  for (const k of Object.keys({ ...a.ifs, ...b.ifs })) {
    const x = a.ifs[k as keyof typeof a.ifs] ?? {};
    const y = b.ifs[k as keyof typeof b.ifs] ?? {};
    if (x.isis !== y.isis) out.push(`${xrIf(k, true)} IS-IS ${y.isis ? "on" : "off"}`);
    if (x.vrf !== y.vrf) out.push(`${xrIf(k, true)} vrf ${y.vrf ?? "none"}`);
  }
  if (JSON.stringify(a.vrfs) !== JSON.stringify(b.vrfs)) out.push("VRF route targets changed");
  if (JSON.stringify(a.statics) !== JSON.stringify(b.statics)) out.push("static routes changed");
  if (JSON.stringify(a.bgp) !== JSON.stringify(b.bgp) || JSON.stringify(a.rr) !== JSON.stringify(b.rr)) out.push("BGP changed");
  return out.join(", ") || "no change";
}
function devCli(c: Ctx, r: SvR): SpDevCli<SvRtr> {
  return {
    host: r,
    running: c.s.cfg[r],
    hist: c.s.hist[r],
    cand: c.cli.cand[r] as SvRtr | undefined,
    setCand: (x) => c.cli.setCand(r, x),
    xr: c.cli.xr[r] ?? [],
    setXr: (st) => c.cli.setXr(r, st),
    edit: !!c.cli.edit[r],
    setEdit: (b) => c.cli.setEdit(r, b),
    commit: (cfg, how) => c.act({ type: "cfg", dev: r, cfg, text: `${cfgDiff(c.s.cfg[r], cfg)} (${how}, IOS XR)` }),
    ask: c.cli.setQuestion,
  };
}
type RTab = "main" | "routes" | "sids" | "term" | "log";
function RouterUI({ c, r }: { c: Ctx; r: SvR }) {
  const pe = r === "PE1" || r === "PE2";
  const [tab, setTab] = useState<RTab>("main");
  const s = c.s;
  const cfg = s.cfg[r];
  const v = c.live.view;
  const change = (f: (x: SvRtr) => void) => {
    const n = spClone(cfg);
    f(n);
    c.act({ type: "cfg", dev: r, cfg: n, text: `${cfgDiff(cfg, n)} (from ${r}'s window)` });
  };
  const api: SvCliApi = { s, act: c.act, dev: devCli(c, r) };
  const tabs: [RTab, string][] = pe ? [["main", "VRFs"], ["routes", "VPN routes"], ["sids", "SIDs"], ["term", "Console"], ["log", "Log"]] : r === "RR1" ? [["main", "Core"], ["routes", "Reflected routes"], ["term", "Console"], ["log", "Log"]] : [["main", "Core"], ["sids", "SIDs"], ["term", "Console"], ["log", "Log"]];
  return (
    <div>
      <Tabs tabs={tabs} cur={tab} set={setTab} />
      <div className="space-y-2 p-3">
        {tab === "main" && pe && (
          <>
            <Card title={`${r} · ${SV_LO[r]} · locator ${locOf(r)}/64`}>
              <div className="grid gap-x-4 sm:grid-cols-2">
                <Kv k="Locator advertised in IS-IS" v={cfg.isisLoc ? "yes" : "no"} tone={cfg.isisLoc ? undefined : "warn"} />
                <Kv k="Session to RR1" v={`${v.sessions[r].up ? "Established" : "down"} · ${[v.sessions[r].vpnv4 ? "VPNv4" : "", v.sessions[r].vpnv6 ? "VPNv6" : ""].filter(Boolean).join(" + ") || "no family"}`} tone={v.sessions[r].vpnv4 && v.sessions[r].vpnv6 ? undefined : "warn"} />
              </div>
            </Card>
            <div className="max-w-full overflow-x-auto">
              <table className="w-full min-w-max text-left text-[12px]">
                <thead className="text-pv-text-faint">
                  <tr>
                    {["Interface", "CE", "VRF", "IPv4", "IPv6"].map((h) => (
                      <th key={h} className="px-1">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SV_CES.filter((x) => SV_CE[x].pe === r).map((ce) => (
                    <tr key={ce} className="border-t border-pv-border/40">
                      <td className="px-1 py-0.5 pv-mono text-pv-text">{xrIf(SV_CE[ce].ifn, true)}</td>
                      <td className="px-1 text-pv-text-muted">{ce}</td>
                      <td className="px-1">
                        <select aria-label={`vrf ${ce}`} className="rounded border border-pv-border bg-pv-bg px-1 text-[12px] text-pv-text" value={cfg.ifs[SV_CE[ce].ifn]?.vrf ?? ""} disabled={c.busy} onChange={(e) => change((x) => void ((x.ifs[SV_CE[ce].ifn] ??= {}).vrf = (e.target.value || undefined) as Vrf | undefined))}>
                          <option value="">(none)</option>
                          {SV_VRFS.map((vr) => (
                            <option key={vr} value={vr}>
                              {vr}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1 pv-mono text-pv-text-muted">{peIfIp(ce, "ipv4")}/24</td>
                      <td className="px-1 pv-mono text-pv-text-muted">{peIfIp(ce, "ipv6") ? `${peIfIp(ce, "ipv6")}/64` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <STable
              cols={["VRF", "RD", "Family", "Import RT", "Export RT", "Service SID"]}
              rows={SV_VRFS.flatMap((vr) =>
                (["ipv4", "ipv6"] as Fam[])
                  .filter((f) => cfg.vrfs[vr]?.[f])
                  .map((f) => {
                    const a = cfg.bgp?.vrf[vr]?.af[f];
                    return [vr, cfg.bgp?.vrf[vr]?.rd ?? ["not set", "bad"], f, cfg.vrfs[vr]![f]!.imp.join(" ") || "—", cfg.vrfs[vr]![f]!.exp.join(" ") || "—", !a ? ["no BGP af", "bad"] : a.srv6On && a.srv6 ? `${a.mode} (${a.srv6})` : ["no SRv6", "bad"]] as Cell[];
                  }),
              )}
            />
            <VrfTables c={c} only={r} />
          </>
        )}
        {tab === "main" && !pe && (
          <>
            <Card title={`${r} · ${SV_LO[r]}${locOf(r) ? ` · locator ${locOf(r)}/64` : ""}`}>
              <p className="text-[12px] text-pv-text-muted">{r === "RR1" ? "Control plane only: reflects VPNv4/VPNv6 routes between the PEs. Customer packets never pass through RR1." : "A P router: IPv6 routing on loopbacks and locators only. No VRFs, no BGP, no customer routes."}</p>
            </Card>
            <STable cols={["Prefix", "Learned", "Next hop"]} rows={v.rib[r].map((x) => [x.pfx, x.kind === "isis" ? `IS-IS (${x.what})` : x.what, x.nh ? `${x.nh.r} (${xrIf(x.nh.ifn, true)})` : "—"] as Cell[])} />
            <STable cols={["Interface", "To", "IS-IS"]} rows={coreIfs(r).map((i) => [xrIf(i.ifn, true), i.peer, v.adj[i.link.id] ? ["Up", "ok"] : ["down", "bad"]] as Cell[])} />
          </>
        )}
        {tab === "routes" && pe && <VpnRoutes c={c} only={r} />}
        {tab === "routes" && r === "RR1" && (
          <STable cols={["RD:prefix", "From", "RT", "Service SID", "Reflected to"]} rows={v.rrTable.map((x) => [`${x.rd}:${x.pfx}`, x.pe, x.rts.join(" ") || "—", x.sid ? `${short(x.sid)} ${x.behavior}` : ["none", "bad"], SV_PES.filter((p) => p !== x.pe && v.sessions[p][x.fam === "ipv4" ? "vpnv4" : "vpnv6"]).join(", ") || ["nobody", "warn"]] as Cell[])} />
        )}
        {tab === "sids" && <Sids c={c} only={r} />}
        {tab === "term" && <SpConsole c={c.cli} sets={svSets(api, r)} os="iosxr" host={r} vendor={c.vendor} setVendor={c.setVendor} />}
        {tab === "log" && (
          <ul className="space-y-0.5">
            {s.sys.filter((x) => x.dev === r).slice(-30).reverse().map((x, i) => (
              <li key={i} className="pv-mono text-[11.5px] text-pv-text-muted">
                {spStamp(x.t).hms} {x.kind === "commit" ? "configuration committed" : x.kind.startsWith("bgp") ? `BGP ${x.peer} ${x.kind === "bgp-up" ? "Up" : "Down"}` : `IS-IS ${x.peer} ${x.kind === "adj-up" ? "Up" : "Down"}`}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
function CeUI({ c, ce }: { c: Ctx; ce: Ce }) {
  const d = SV_CE[ce];
  const [to, setTo] = useState(DESTS[0]);
  const fams: Fam[] = d.host6 ? ["ipv4", "ipv6"] : ["ipv4"];
  return (
    <div className="space-y-2 p-3">
      <Card title={`${ce} · ${d.vrf} site at ${d.pe} (${xrIf(d.ifn, true)})`}>
        <p className="mb-1 text-[11.5px] text-pv-text-faint">A customer router: it knows its LAN and sends everything else to the provider. It has never heard of VRFs, SIDs or BGP.</p>
        <STable cols={["Prefix", "Via"]} rows={[...fams.flatMap((f) => [[f === "ipv4" ? pfx4(d.lan4) : pfx6(d.lan6!), `connected (host ${ceHost(ce, f)})`], [f === "ipv4" ? `${d.link4}0/24` : `${d.link6}/64`, `connected (${ceIfIp(ce, f)})`], [f === "ipv4" ? "0.0.0.0/0" : "::/0", `${peIfIp(ce, f)} (${d.pe})`]] as Cell[][])]} />
      </Card>
      <Card title="Ping from this site's host">
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <select aria-label={`${ce} destination`} className="rounded border border-pv-border bg-pv-bg px-1 py-0.5 text-[12px] text-pv-text" value={to} onChange={(e) => setTo(e.target.value)}>
            {DESTS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
          <Pill onClick={() => c.act({ type: "ping", src: { ce }, to })} disabled={c.busy} tone="primary">
            ping
          </Pill>
        </div>
      </Card>
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
  const sel = "rounded border border-pv-border bg-pv-bg px-1 py-0.5 text-[12px] text-pv-text";
  const [src, setSrc] = useState<Ce>("CE1");
  const [to, setTo] = useState(DESTS[0]);
  return (
    <div className="space-y-2 rounded-xl border border-pv-border p-2">
      <p className="text-[12px] font-semibold text-pv-text">Customer traffic (ping: request and reply)</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <select aria-label="Source" className={sel} value={src} onChange={(e) => setSrc(e.target.value as Ce)}>
          {SV_CES.map((x) => (
            <option key={x} value={x}>
              {x} ({SV_CE[x].vrf})
            </option>
          ))}
        </select>
        <span className="text-pv-text-faint">→</span>
        <select aria-label="Destination" className={sel} value={to} onChange={(e) => setTo(e.target.value)}>
          {DESTS.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <Pill onClick={() => c.act({ type: "ping", src: { ce: src }, to })} disabled={c.busy} tone="primary">
          ping
        </Pill>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <Pill onClick={() => c.act({ type: "ping", src: { ce: "CE1" }, to: "10.20.1.10" })} disabled={c.busy}>
          CE1 → 10.20.1.10
        </Pill>
        <Pill onClick={() => c.act({ type: "ping", src: { ce: "CE1" }, to: "2001:db8:ca:20::a" })} disabled={c.busy}>
          CE1 → 2001:db8:ca:20::a
        </Pill>
        <Pill onClick={() => c.act({ type: "ping", src: { ce: "CE4" }, to: "10.20.1.10" })} disabled={c.busy}>
          CE4 → 10.20.1.10
        </Pill>
        <Pill onClick={() => c.act({ type: "wipe-pe2" })} disabled={c.busy || !c.s.cfg.PE2.bgp?.vrf["CUST-A"]} tone="danger">
          Remove PE2&apos;s BGP VRF
        </Pill>
      </div>
      <p className="text-[11.5px] text-pv-text-faint">Open a CE to ping from its host, or a PE console for <span className="pv-mono">ping vrf</span>.</p>
    </div>
  );
}

const SPEC: SpLabSpec<SvState, SvAction, SvSnap> = {
  title: "SRv6 L3VPN Lab",
  note: () => "CUST-A + CUST-B over SRv6 · IOS XR",
  fresh: (seq) => createSvNet(seq),
  vendors: ["cisco"],
  apply: svApply,
  snapOf: (s) => ({ view: s.view }),
  ticketAction: (id) => ({ type: "ticket", id: id as SvTicketId }),
  levels: SV_LEVELS,
  gate: {
    title: "You can operate an SRv6 L3VPN",
    points: [
      "A VRF per customer on each PE; overlapping addresses stay apart because the ingress interface picks the VRF.",
      "A customer route becomes a VPN route: RD, RT, the PE's loopback as next hop, and an SRv6 service SID.",
      "Import is decided by RT; install also needs a reachable next hop and a reachable SID (its locator in the IGP).",
      "The core routes on the outer IPv6 destination — the egress PE's locator — and never sees customer routes.",
      "End.DT4/DT6 decapsulates and looks up in the VRF; End.DX4/DX6 sends straight to one CE.",
    ],
    more: "The engineering workspace gives you every PE, P router, RR1 and CE in its own window (VRFs, VPN routes, SIDs, IOS XR consoles with commit), pings between any site and any address, five challenges and five tickets.",
  },
  stage,
  footer: (c) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
      <span>
        sessions: <b className="text-pv-text">{SV_PES.map((p) => `${p} ${c.live.view.sessions[p].up ? "up" : "down"}`).join(" · ")}</b> · installed VPN routes: <b className="text-pv-text">{SV_PES.map((p) => `${p} ${c.live.view.imported[p].filter((x) => x.installed).length}`).join(" · ")}</b>
      </span>
      <span className="text-pv-text-faint">violet: request (SRv6 in the core) · amber: reply</span>
    </div>
  ),
  devices: [...SV_ROUTERS, ...SV_CES],
  device: (id) => (id.startsWith("CE") ? { label: id, icon: "CE", tone: VRF_TONE[SV_CE[id as Ce].vrf], sub: `${SV_CE[id as Ce].vrf} · ${SV_CE[id as Ce].pe}` } : { label: id, icon: role(id) === "RR" ? "P" : role(id), tone: id === "RR1" ? "#a78bfa" : "#22d3ee", sub: `${SV_LO[id as SvR]} · IOS XR` }),
  openFrom: 1,
  window: (id, c) => (id.startsWith("CE") ? <CeUI c={c} ce={id as Ce} /> : <RouterUI c={c} r={id as SvR} />),
  tools: [
    { id: "routes", label: "VPN routes", render: (c) => <VpnRoutes c={c} /> },
    { id: "vrf", label: "VRF tables", render: (c) => <VrfTables c={c} /> },
    { id: "sids", label: "Local SIDs", render: (c) => <Sids c={c} /> },
    { id: "headers", label: "Headers, hop by hop", render: (c) => <Headers c={c} /> },
    { id: "path", label: "Last ping, step by step", render: (c) => <PathView c={c} /> },
    { id: "log", label: "Log", render: (c) => <LogTool c={c} /> },
  ],
  toolsLabel: { learn: "What the routers know", eng: "Tools" },
  evidence,
  composer: (c) => <Composer c={c} />,
  investigate: [
    "Ping 10.20.1.10 from CE1 and from CE4. Who answers each, and which SID did each use?",
    "On PE1: show bgp vpnv4 unicast rd 65000:2 10.20.1.0/24 — find the RT, the next hop and the service SID.",
    "On PE2: show segment-routing srv6 sid. Which SID belongs to which VRF and family?",
    "On P1: show route ipv6. Which prefixes does a P router need to carry customer traffic?",
    "On PE1: show cef vrf CUST-A 10.20.1.10 — what will PE1 push?",
  ],
  challenges: SV_CHALLENGES,
  tickets: SV_TICKETS.map((t) => ({ id: t.id, title: t.title, report: t.report, reproLabel: t.reproLabel, repro: t.repro })),
  ticketIntro: "Customers report what they see — sites unreachable, one family broken, replies missing. Each ticket is this network after a change with one real thing wrong. Reproduce it, climb the evidence ladder (customer route, VPN route and SID, session families, import, SID reachability, the way back), name the cause, fix it on the router, and prove it with fresh customer traffic.",
  reproHint: "Watch where the ping dies — request or reply — and which family.",
  fixHint: "Fix it on the router (its window or console — commit to apply), check the VPN routes, then ping from CE1 again.",
  causes: SV_CAUSES,
  feedback: svCauseFeedback,
  proofs: svProofs,
  ladder: (s) => svLadder(s),
  text: (v, t) => spText(v, t),
  runCard: (c) => (
    <Card title="Result">
      <TestView c={c} />
    </Card>
  ),
};

export function SvLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SpLabWorkspace spec={SPEC} open={open} onClose={onClose} />;
}
