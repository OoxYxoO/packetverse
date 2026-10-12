"use client";

import { useMemo, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { SpLabWorkspace, type SpCtx, type SpLabSpec } from "@/components/sp-lab/SpLabWorkspace";
import { SpStage, type SpPath, type SpStageLink, type SpStageNode } from "@/components/sp-lab/SpStage";
import { SpConsole } from "@/components/sp-lab/SpDesk";
import { Card, Kv, Pill, STable, Tabs } from "@/components/sp-lab/SpUi";
import { spClone, spStamp, type SpMoment } from "@/components/sp-lab/spKit";
import type { SpDevCli } from "@/components/sp-lab/spCli";
import { ifName, spText } from "@/components/sp-lab/spNames";
import type { TopoView } from "@/components/presentation/Visuals";
import { CES, IMPLICIT_NULL, VS_CES, VS_LINKS, VS_LO, VS_ROUTERS, acKey, createVsNet, ldpLabel, vsApply, type IfName, type VsCe, type VsFdb, type VsR } from "@/lib/sim-engine/scenarios/vsNet";
import { BV_LO, BV_PES, BV_ROUTERS, RR_CLUSTER, bvApply, createBvNet, peOfLo } from "@/lib/sim-engine/scenarios/bvNet";
import {
  EM_CAUSES,
  EM_PES,
  EM_TICKETS,
  createEmNet,
  emApply,
  emCauseFeedback,
  emLadder,
  emMacTable,
  emProofs,
  emRouteKey,
  emWhyNoPeer,
  floodList,
  imLabel,
  uniLabel,
  type EmAction,
  type EmCfg,
  type EmR,
  type EmRoute,
  type EmSnap,
  type EmState,
  type EmTicketId,
} from "@/lib/sim-engine/scenarios/emNet";
import { emPipe, emSets, xrSub, type EmCliApi } from "./emCli";
import { EVO_LEVELS } from "./evoLearn";
import { EVO_CHALLENGES } from "./evoPractice";

/**
 * L2VPN Evolution Lab — the CUST-A LAN of the VPLS and BGP VPLS labs, now carried by EVPN-MPLS (EVI 100).
 *   LEARN                  6 levels (evoLearn): same LAN, a third control plane · Type 3 · Type 2 · two labels per PE ·
 *                          when it breaks · what evolved (compared with LDP VPLS and BGP VPLS from their own models)
 *   ENGINEERING WORKSPACE  Investigate (customer pings; router windows with the EVI, the EVPN routes, labels and an
 *                          IOS XR / Junos console) · Challenges (five) · Troubleshoot (five tickets)
 * One model (emNet.ts) produces every EVPN route, label, flood list, MAC table entry and verdict.
 */

type Ctx = SpCtx<EmState, EmAction, EmSnap>;
type Node = EmR | VsCe;
const POS: Record<Node, { x: number; y: number; cx: number; cy: number }> = {
  CE1: { x: 6, y: 50, cx: 6, cy: 36 },
  PE1: { x: 22, y: 50, cx: 22, cy: 36 },
  P1: { x: 40, y: 50, cx: 40, cy: 64 },
  RR1: { x: 40, y: 20, cx: 40, cy: 8 },
  P2: { x: 58, y: 28, cx: 58, cy: 16 },
  P3: { x: 58, y: 76, cx: 58, cy: 90 },
  PE2: { x: 77, y: 28, cx: 77, cy: 16 },
  PE3: { x: 77, y: 76, cx: 77, cy: 90 },
  CE2: { x: 94, y: 14, cx: 94, cy: 4 },
  CE4: { x: 94, y: 42, cx: 94, cy: 54 },
  CE3: { x: 94, y: 76, cx: 94, cy: 90 },
};
const role = (d: string) => (d.startsWith("CE") ? "CE" : d.startsWith("PE") ? "PE" : d === "RR1" ? "RR" : "P");
const isPe = (r: EmR) => (BV_PES as string[]).includes(r);
const acName = (c: Ctx, k: string) => (c.vendor === "cisco" ? xrSub(k, true) : k);
const macTone = (m: string) => ({ "00:11": "#a78bfa", "00:22": "#fbbf24", "00:33": "#34d399", "00:44": "#f472b6" })[m.slice(0, 5)] ?? "#94a3b8";
const owner = (mac: string) => VS_CES.find((x) => CES[x].mac === mac) ?? "?";
const routeName = (r: EmRoute) => (r.type === 3 ? `Type 3 · ${r.nh}` : `Type 2 · ${r.mac}${r.ip ? ` · ${r.ip}` : ""}`);

function stage(c: Ctx, p: { moment?: SpMoment<EmSnap>; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) {
  const s = c.s;
  const v = c.live.view;
  const fdb = (p.moment?.snap ?? c.live).fdb;
  const nodes: SpStageNode[] = (Object.keys(POS) as Node[]).map((d) => ({ id: d, label: d, role: role(d), tone: d.startsWith("CE") ? macTone(CES[d as VsCe].mac) : d === "RR1" ? "#a78bfa" : "#22d3ee", sub: d.startsWith("CE") ? CES[d as VsCe].ip.replace("192.168.", "…") : BV_LO[d as EmR], ...POS[d] }));
  const links: SpStageLink[] = [
    ...VS_CES.map((ce) => {
      const x = CES[ce];
      const k = acKey(x.ifn, x.vlan);
      const ac = s.cfg[x.pe].acs[k];
      const ok = !!ac && ac.vlan === x.vlan && !!s.cfg[x.pe].bd?.acs.includes(k);
      return { id: `${x.pe}-${ce}`, a: x.pe, b: ce, state: (ok ? "up" : "blocked") as SpStageLink["state"], label: ok ? "AC" : ac ? `AC VLAN ${ac.vlan ?? "?"}` : "not in EVI" };
    }),
    ...VS_LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b, state: (v.ldp[l.id] ? "up" : "blocked") as SpStageLink["state"], label: v.ldp[l.id] ? "LDP" : "no LDP" })),
    { id: "P1-RR1", a: "P1", b: "RR1", state: "up" as SpStageLink["state"], label: "IS-IS" },
    ...BV_PES.map((pe) => ({ id: `bgp-${pe}`, a: pe, b: "RR1", state: (v.bgp[pe].evpn ? "standby" : "blocked") as SpStageLink["state"], label: v.bgp[pe].evpn ? "iBGP EVPN" : v.bgp[pe].up ? "no EVPN" : "BGP down" })),
    ...[["PE1", "PE2"], ["PE1", "PE3"], ["PE2", "PE3"]].map(([a, b]) => {
      const ab = floodList(v, a as VsR).some((r) => r.pe === b);
      const ba = floodList(v, b as VsR).some((r) => r.pe === a);
      return { id: `im-${a}-${b}`, a, b, state: (ab && ba ? "standby" : ab || ba ? "blocked" : "down") as SpStageLink["state"], label: ab && ba ? "Type 3" : ab || ba ? "Type 3 one way" : "no Type 3" };
    }),
  ];
  const views: Record<string, TopoView> = {};
  for (const pe of BV_PES) views[pe] = { badge: { text: `MACs ${fdb[pe].length} + ${emMacTable(v, fdb, pe).filter((m) => m.remote).length}`, tone: "info" } };
  views.RR1 = { badge: { text: `${v.rrTable.length} EVPN routes`, tone: "info" } };
  const paths: SpPath[] = [];
  const last = s.tests[s.tests.length - 1];
  if (last && !p.moment && last.cfgSeq === s.cfgSeq && !last.flooded) paths.push({ id: "t", nodes: last.path.filter((x, i, a) => a.indexOf(x) === i), color: last.ok ? "#34d399" : "#f87171", offset: 0 });
  return <SpStage nodes={nodes} links={links} paths={paths} views={views} moment={p.moment} momentKey={p.momentKey} compact={p.compact} onNode={p.onNode} selected={p.selected} regions={[{ x: 15, y: 8, w: 70, h: 80, label: "IS-IS + LDP core", color: "#22d3ee" }]} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------------------------
type Cell = string | [string, "ok" | "bad"];
function Flood({ c, only }: { c: Ctx; only?: VsR }) {
  const v = c.live.view;
  const rows = EM_PES.filter((pe) => !only || pe === only).flatMap((pe) =>
    EM_PES.filter((x) => x !== pe).map((x) => {
      const r = floodList(v, pe).find((y) => y.pe === x);
      return [pe, `${x} (${BV_LO[x]})`, r ? String(r.label) : "—", r ? ["on the flood list", "ok"] : [emWhyNoPeer(c.s.cfg, v, pe, x, c.s.os), "bad"]] as Cell[];
    }),
  );
  return <STable cols={["PE", "Remote PE", "Its inclusive-multicast label", "Status"]} rows={rows} />;
}
function Routes({ c, only }: { c: Ctx; only?: EmR }) {
  const v = c.live.view;
  const who: EmR[] = only ? [only] : ["RR1", ...EM_PES];
  const rows = who.flatMap((r) => {
    if (r === "RR1") return v.rrTable.map((x) => ["RR1", routeName(x), x.pe, x.rd, `RT ${x.rt}`, String(x.label), ["held, reflected by client rules", "ok"]] as Cell[]);
    if (!isPe(r)) return [];
    const own = v.adv.filter((x) => x.pe === r).map((x) => [r, routeName(x), "local", x.rd, `RT ${x.rt}`, String(x.label), ["advertised", "ok"]] as Cell[]);
    const rx = v.received[r].map((x) => {
      const kept = v.kept[r].some((y) => emRouteKey(y) === emRouteKey(x));
      const use = v.usable[r].some((y) => emRouteKey(y) === emRouteKey(x));
      return [r, routeName(x), x.pe, x.rd, `RT ${x.rt}`, String(x.label), use ? ["kept, usable", "ok"] : kept ? ["kept, unusable (no LSP to the next hop)", "bad"] : [`not imported (${r} imports ${c.s.cfg[r].evi?.rt ?? "nothing"})`, "bad"]] as Cell[];
    });
    return [...own, ...rx];
  });
  return <STable cols={["Router", "Route", "From", "RD", "Route target", "Label", "Status"]} rows={rows} empty="No EVPN routes here." />;
}
function Bgp({ c }: { c: Ctx }) {
  const v = c.live.view;
  const rr = c.s.cfg.RR1.rr;
  const rows = BV_PES.map((pe) => {
    const cl = rr?.clients.find((x) => x.ip === BV_LO[pe]);
    return [`${pe} ↔ RR1`, v.bgp[pe].up ? ["Established", "ok"] : ["down", "bad"], v.bgp[pe].evpn ? ["L2VPN EVPN", "ok"] : ["not negotiated", "bad"], cl?.client ? "yes" : ["no", "bad"], String(v.received[pe].length), String(v.kept[pe].length)] as Cell[];
  });
  return <STable cols={["Session", "State", "Family", "RR client", "Routes received", "Kept (RT imported)"]} rows={rows} />;
}
function Labels({ c }: { c: Ctx }) {
  const rows = EM_PES.map((pe) => [pe, String(uniLabel(c.s.os, pe)), String(imLabel(c.s.os, pe)), EM_PES.filter((x) => x !== pe && floodList(c.live.view, x).some((r) => r.pe === pe)).join(", ") || "nobody"] as string[]);
  return <STable cols={["PE", "Unicast label (in its Type 2 routes)", "Inclusive-multicast label (in its Type 3 route)", "Who floods to it"]} rows={rows} />;
}
function Macs({ c, only }: { c: Ctx; only?: VsR }) {
  const v = c.live.view;
  const rows = EM_PES.filter((pe) => !only || pe === only).flatMap((pe) => emMacTable(v, c.live.fdb, pe).map((m) => [pe, m.mac, owner(m.mac), m.remote ? `${peOfLo(m.remote)}'s Type 2 route (label ${m.label})` : `${acName(c, m.where)} (learned locally)`, m.ip ?? "—"] as string[]));
  return <STable cols={["PE", "MAC", "Belongs to", "Known from", "IP (MAC+IP route)"]} rows={rows} empty="Empty: nothing has been sent since the tables were cleared." />;
}
function Ldp({ c }: { c: Ctx }) {
  const v = c.live.view;
  const rows = VS_LINKS.map((l) => [`${l.a} – ${l.b}`, v.ldp[l.id] ? ["Operational", "ok"] : ["none", "bad"]] as Cell[]);
  return <STable cols={["Link session", "State"]} rows={rows} />;
}
function Lsp({ c }: { c: Ctx }) {
  const v = c.live.view;
  const rows = VS_ROUTERS.flatMap((r) =>
    BV_PES.filter((pe) => pe !== r).map((pe) => {
      const fec = VS_LO[pe];
      const t = v.lsp[r][fec];
      return [r, `${fec}/32`, String(ldpLabel(c.s.os, r, fec)), t?.out === undefined ? ["none (Unlabelled)", "bad"] : t.out === IMPLICIT_NULL ? "pop (PHP)" : String(t.out), t?.nh ?? "—"] as Cell[];
    }),
  );
  return <STable cols={["Router", "FEC", "Local label", "Outgoing label", "Toward"]} rows={rows} />;
}
/** The same pings, replayed on healthy LDP VPLS and BGP VPLS networks (those labs' own models). */
function Compare({ c }: { c: Ctx }) {
  const s = c.s;
  const pings = s.tests.slice(-12).map((t) => ({ from: t.from, dst: t.dst }));
  const key = `${s.os}|${pings.map((x) => `${x.from}>${x.dst}`).join(",")}`;
  const cmp = useMemo(() => {
    let vs = createVsNet(0, s.os);
    let bv = createBvNet(0, s.os);
    let vf = 0;
    let bf = 0;
    for (const p of pings) {
      vs = vsApply(vs, { type: "test", ...p });
      bv = bvApply(bv, { type: "test", ...p });
      if (vs.tests.at(-1)!.flooded) vf++;
      if (bv.tests.at(-1)!.flooded) bf++;
    }
    return { vs, bv, vf, bf };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const remote = (f: VsFdb) => EM_PES.reduce((n, pe) => n + f[pe].filter((m) => m.port.startsWith("pw:")).length, 0);
  const where = (f: VsFdb) => {
    const m = f.PE2.find((x) => x.mac === CES.CE3.mac);
    return m ? (m.port.startsWith("pw:") ? `a frame from CE3 on the pseudowire from ${peOfLo(m.port.slice(3))}` : m.port) : "not known";
  };
  const em2 = emMacTable(s.view, s.fdb, "PE2").find((m) => m.mac === CES.CE3.mac);
  const emRemote = EM_PES.reduce((n, pe) => n + emMacTable(s.view, s.fdb, pe).filter((m) => m.remote).length, 0);
  const ef = s.tests.slice(-12).filter((t) => t.flooded).length;
  const nbrs = EM_PES.reduce((n, pe) => n + (cmp.vs.cfg[pe].bd?.nbrs.length ?? 0), 0);
  const rows: string[][] = [
    ["Who is a member", `${nbrs} neighbor statements (each PE lists the others)`, `${cmp.bv.view.rrTable.length} VPLS routes with RT 65000:100`, `${s.view.adv.filter((r) => r.type === 3).length} Type 3 routes with RT 65000:100`],
    ["Pseudowire ends", `${cmp.vs.view.pws.length} (${cmp.vs.view.pws.filter((p) => p.up).length} up)`, `${cmp.bv.view.pws.length} (${cmp.bv.view.pws.filter((p) => p.up).length} up)`, "none"],
    ["Signaling the labels", "targeted LDP, one label per pseudowire", "BGP label blocks (base + VE ID − offset)", "BGP: one unicast + one inclusive-multicast label per PE"],
    ["How PE2 knows where CE3 is", where(cmp.vs.fdb), where(cmp.bv.fdb), em2 ? `PE3's Type 2 route (label ${em2.label})` : "not known"],
    ["Remote MACs known (all PEs)", String(remote(cmp.vs.fdb)), String(remote(cmp.bv.fdb)), String(emRemote)],
    [`Of the last ${pings.length} pings, flooded`, String(cmp.vf), String(cmp.bf), String(ef)],
  ];
  return (
    <div className="space-y-1">
      <STable cols={["", "LDP VPLS", "BGP VPLS", "EVPN-MPLS (this lab)"]} rows={rows} />
      <p className="text-[11.5px] text-pv-text-faint">The VPLS columns replay this lab&apos;s last pings on healthy LDP VPLS and BGP VPLS networks — the models of those two labs, same routers, same CEs.</p>
    </div>
  );
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
        ping {t.dst} from {t.from}: <span className={t.ok ? "text-pv-success" : "text-pv-danger"}>{t.ok ? `success — reached ${t.reached}` : "failed"}</span>
        <span className="ml-2 text-[11.5px] font-normal text-pv-text-muted">{t.flooded ? "(some frames flooded)" : "(every frame unicast)"}</span>
      </p>
      {t.why && <p className="text-[11.5px] text-pv-warning">{spText(c.vendor, t.why)}</p>}
    </div>
  );
}
function Ladder({ c }: { c: Ctx }) {
  if (c.busy) return <p className="text-[12px] text-pv-text-faint">The ladder fills in when the run has finished.</p>;
  return (
    <ol className="space-y-1">
      {emLadder(c.s).map((r, i) => (
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
    case "cmp":
      return card("Three architectures, the same customer", <Compare c={c} />);
    case "flood":
      return card("Flood lists (from Type 3 routes)", <Flood c={c} />);
    case "routes":
      return card("EVPN routes in BGP", <Routes c={c} />);
    case "bgp":
      return card("BGP sessions to the route reflector", <Bgp c={c} />);
    case "labels":
      return card("EVPN labels", <Labels c={c} />);
    case "macs":
      return card("MAC tables on the PEs", <Macs c={c} />);
    case "path":
      return card("What each frame did", <PathView c={c} />);
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
function cfgDiff(a: EmCfg, b: EmCfg): string {
  const out: string[] = [];
  for (const k of new Set([...Object.keys(a.acs), ...Object.keys(b.acs)])) {
    if (!a.acs[k]) out.push(`${k} created`);
    else if (!b.acs[k]) out.push(`${k} removed`);
    else if (JSON.stringify(a.acs[k]) !== JSON.stringify(b.acs[k])) out.push(`${k} changed`);
  }
  if (!a.bd && b.bd) out.push(`bridge domain ${b.bd.name} created`);
  else if (a.bd && !b.bd) out.push(`bridge domain ${a.bd.name} removed`);
  else if (a.bd && b.bd) {
    if (a.bd.acs.join() !== b.bd.acs.join()) out.push("bridge-domain interfaces changed");
    if (a.bd.evi !== b.bd.evi) out.push(b.bd.evi !== undefined ? `bridge domain bound to EVI ${b.bd.evi}` : "bridge domain unbound from its EVI");
    if (a.bd.vlanId !== b.bd.vlanId) out.push(`instance vlan-id ${b.bd.vlanId ?? "removed"}`);
  }
  if (!a.evi && b.evi) out.push(`EVI ${b.evi.id} created`);
  else if (a.evi && !b.evi) out.push(`EVI ${a.evi.id} removed`);
  else if (a.evi && b.evi) {
    if (a.evi.rd !== b.evi.rd) out.push(`EVI RD ${b.evi.rd ?? "removed"}`);
    if (a.evi.rt !== b.evi.rt) out.push(`EVI RT ${b.evi.rt ?? "removed"}`);
    if (a.evi.advMac !== b.evi.advMac) out.push(`advertise-mac ${b.evi.advMac ? "on" : "off"}`);
  }
  if (JSON.stringify(a.nbr) !== JSON.stringify(b.nbr)) out.push(b.nbr ? `BGP neighbor ${b.nbr.ip}${b.nbr.evpn ? " (EVPN)" : " (no EVPN family)"}` : "BGP neighbor removed");
  if (JSON.stringify(a.rr) !== JSON.stringify(b.rr)) out.push("route-reflector clients changed");
  for (const k of new Set([...Object.keys(a.ldp), ...Object.keys(b.ldp)]) as Set<IfName>) if (!!a.ldp[k] !== !!b.ldp[k]) out.push(`${k} LDP ${b.ldp[k] ? "on" : "off"}`);
  return out.join(", ") || "no change";
}
function devCli(c: Ctx, r: EmR): SpDevCli<EmCfg> {
  return {
    host: r,
    running: c.s.cfg[r],
    hist: c.s.hist[r],
    cand: c.cli.cand[r] as EmCfg | undefined,
    setCand: (x) => c.cli.setCand(r, x),
    xr: c.cli.xr[r] ?? [],
    setXr: (st) => c.cli.setXr(r, st),
    edit: !!c.cli.edit[r],
    setEdit: (b) => c.cli.setEdit(r, b),
    commit: (cfg, how) => c.act({ type: "cfg", dev: r, cfg, text: `${cfgDiff(c.s.cfg[r], cfg)} (${how}, ${c.vendor === "cisco" ? "IOS XR" : "Junos"})` }),
    ask: c.cli.setQuestion,
  };
}
type Tab = "evpn" | "bgp" | "labels" | "term" | "log";
function RouterUI({ c, r }: { c: Ctx; r: EmR }) {
  const pe = isPe(r);
  const rr = r === "RR1";
  const [tab, setTab] = useState<Tab>(pe ? "evpn" : rr ? "bgp" : "labels");
  const s = c.s;
  const cfg = s.cfg[r];
  const change = (f: (x: EmCfg) => void) => {
    const n = spClone(cfg);
    f(n);
    c.act({ type: "cfg", dev: r, cfg: n, text: `${cfgDiff(cfg, n)} (from ${r}'s window)` });
  };
  const api: EmCliApi = { s, act: c.act, dev: devCli(c, r) };
  const tabs: [Tab, string][] = [...(pe ? ([["evpn", "EVPN"]] as [Tab, string][]) : []), ...(pe || rr ? ([["bgp", "BGP"]] as [Tab, string][]) : []), ...(!rr ? ([["labels", "Labels & LDP"]] as [Tab, string][]) : []), ["term", "Console"], ["log", "Log"]];
  return (
    <div>
      <Tabs tabs={tabs} cur={tab} set={setTab} />
      <div className="space-y-2 p-3">
        {tab === "evpn" && pe && (
          <>
            <Card title={cfg.evi ? `EVI ${cfg.evi.id}${cfg.bd ? ` · ${c.vendor === "cisco" ? `bridge group ${cfg.bd.group} · bridge-domain` : "routing-instance"} ${cfg.bd.name}` : ""}` : "No EVPN instance configured"}>
              {(cfg.evi || cfg.bd) && (
                <div className="grid gap-x-4 sm:grid-cols-2">
                  <Kv k="Attachment circuits" v={cfg.bd?.acs.map((k) => `${acName(c, k)} · VLAN ${cfg.acs[k]?.vlan ?? "none"}`).join(", ") || "none"} tone={cfg.bd?.acs.length ? undefined : "warn"} />
                  <Kv k="RD" v={cfg.evi?.rd ?? "none"} tone={cfg.evi?.rd ? undefined : "warn"} />
                  <Kv k="RT (import and export)" v={cfg.evi?.rt ?? "none"} tone={cfg.evi?.rt ? undefined : "warn"} />
                  <Kv k="Labels (unicast / multicast)" v={`${uniLabel(s.os, r as VsR)} / ${imLabel(s.os, r as VsR)}`} />
                  {c.vendor === "cisco" ? <Kv k="Bridge domain → EVI · advertise-mac" v={`${cfg.bd?.evi !== undefined ? `evi ${cfg.bd.evi}` : "not bound"} · ${cfg.evi?.advMac ? "yes" : "no"}`} tone={cfg.bd?.evi !== undefined && cfg.evi?.advMac ? undefined : "warn"} /> : <Kv k="Instance vlan-id" v={String(cfg.bd?.vlanId ?? "none")} />}
                </div>
              )}
            </Card>
            <Flood c={c} only={r as VsR} />
            <Macs c={c} only={r as VsR} />
            <div className="flex flex-wrap items-center gap-2">
              <Pill onClick={() => c.act({ type: "clear", dev: r as VsR })} disabled={c.busy}>
                Clear {r}&apos;s MAC table
              </Pill>
              <span className="text-[11.5px] text-pv-text-faint">The EVI itself is configured in the Console (candidate + commit).</span>
            </div>
          </>
        )}
        {tab === "bgp" && (pe || rr) && (
          <>
            {rr ? (
              <Card title={`RR1 · cluster ${RR_CLUSTER}`}>
                <STable cols={["Neighbor", "L2VPN EVPN", "Route-reflector client"]} rows={(cfg.rr?.clients ?? []).map((x) => [x.ip, x.evpn ? "yes" : ["no", "bad"], x.client ? "yes" : ["no", "bad"]] as Cell[])} empty="No neighbors." />
              </Card>
            ) : (
              <Card title="BGP">
                <Kv k="Neighbor" v={cfg.nbr ? `${cfg.nbr.ip} (RR1)` : "none"} tone={cfg.nbr ? undefined : "warn"} />
                <Kv k="L2VPN EVPN family" v={c.live.view.bgp[r].evpn ? "negotiated" : cfg.nbr?.evpn ? "configured here, not negotiated" : "not configured"} tone={c.live.view.bgp[r].evpn ? undefined : "warn"} />
              </Card>
            )}
            <Routes c={c} only={r} />
          </>
        )}
        {tab === "labels" && !rr && (
          <>
            <div className="max-w-full overflow-x-auto">
              <table className="w-full min-w-max text-left text-[12px]">
                <thead className="text-pv-text-faint">
                  <tr>
                    {["Core interface", "To", "LDP", "Session"].map((h) => (
                      <th key={h} className="px-1">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {VS_LINKS.filter((l) => l.a === r || l.b === r).map((l) => {
                    const ifn = l.a === r ? l.ai : l.bi;
                    const peer = l.a === r ? l.b : l.a;
                    return (
                      <tr key={l.id} className="border-t border-pv-border/40">
                        <td className="px-1 py-0.5 pv-mono text-pv-text">{ifName(c.vendor, ifn)}</td>
                        <td className="px-1 text-pv-text-muted">{peer}</td>
                        <td className="px-1">
                          <input type="checkbox" aria-label={`ldp ${ifn}`} checked={!!cfg.ldp[ifn]} disabled={c.busy} onChange={(e) => change((x) => void (x.ldp[ifn] = e.target.checked))} />
                        </td>
                        <td className={clsx("px-1", c.live.view.ldp[l.id] ? "text-pv-success" : "text-pv-danger")}>{c.live.view.ldp[l.id] ? "Operational" : "none"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Lsp c={c} />
          </>
        )}
        {tab === "term" && <SpConsole c={c.cli} sets={emSets(api, r)} os={c.vendor === "cisco" ? "iosxr" : "junos"} host={r} vendor={c.vendor} setVendor={c.setVendor} pipeCtx={c.vendor === "juniper" ? emPipe(api, r) : undefined} />}
        {tab === "log" && (
          <ul className="space-y-0.5">
            {s.sys.filter((x) => x.dev === r).slice(-30).reverse().map((x, i) => (
              <li key={i} className="pv-mono text-[11.5px] text-pv-text-muted">
                {spStamp(x.t).hms} {x.kind === "commit" ? "configuration committed" : x.kind === "clear" ? "MAC table cleared" : x.kind.startsWith("bgp") ? `BGP ${x.peer} ${x.kind === "bgp-up" ? "Established" : "down"}` : `LDP ${x.peer} ${x.kind === "ldp-up" ? "up" : "down"}`}
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
const HOSTS = ["192.168.100.1", "192.168.100.2", "192.168.100.3", "192.168.100.4"];
function Composer({ c }: { c: Ctx }) {
  const [from, setFrom] = useState<VsCe>("CE1");
  const [to, setTo] = useState("192.168.100.3");
  const sel = "rounded border border-pv-border bg-pv-bg px-1 py-0.5 text-[12px] text-pv-text";
  return (
    <div className="space-y-2 rounded-xl border border-pv-border p-2">
      <p className="text-[12px] font-semibold text-pv-text">Customer traffic</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <select aria-label="From" className={sel} value={from} onChange={(e) => setFrom(e.target.value as VsCe)}>
          {VS_CES.map((x) => (
            <option key={x} value={x}>
              {x} ({CES[x].ip}, at {CES[x].pe})
            </option>
          ))}
        </select>
        <span className="text-pv-text-faint">→</span>
        <select aria-label="To" className={sel} value={to} onChange={(e) => setTo(e.target.value)}>
          {HOSTS.map((h) => (
            <option key={h}>{h}</option>
          ))}
        </select>
        <Pill onClick={() => c.act({ type: "test", from, dst: to })} disabled={c.busy} tone="primary">
          ping
        </Pill>
        <Pill onClick={() => c.act({ type: "clear" })} disabled={c.busy}>
          Clear all MAC tables
        </Pill>
      </div>
      {!c.s.ticket && (
        <div className="flex flex-wrap items-center gap-2">
          <Pill onClick={() => c.act({ type: "wipe-pe3" })} disabled={c.busy || !!c.s.wiped} tone="danger">
            Wipe PE3&apos;s EVPN
          </Pill>
          <span className="text-[11.5px] text-pv-text-faint">for challenge 4</span>
        </div>
      )}
    </div>
  );
}

const SPEC: SpLabSpec<EmState, EmAction, EmSnap> = {
  title: "L2VPN Evolution Lab",
  note: () => "the CUST-A LAN on EVPN-MPLS · compared with LDP VPLS and BGP VPLS",
  fresh: (seq, vendor) => createEmNet(seq, vendor === "cisco" ? "xr" : "junos"),
  vendorAction: (v) => ({ type: "os", os: v === "cisco" ? "xr" : "junos" }),
  apply: emApply,
  snapOf: (s) => ({ view: s.view, fdb: s.fdb }),
  ticketAction: (id) => ({ type: "ticket", id: id as EmTicketId }),
  levels: EVO_LEVELS,
  gate: {
    title: "You can read an EVPN-MPLS service — and say what it replaced",
    points: [
      "LDP VPLS: members are configured neighbors; a pseudowire per pair; MACs learned from frames.",
      "BGP VPLS: members discovered from BGP routes (RD, RT, VE ID, label block); still a pseudowire per pair; still data-plane learning.",
      "EVPN: no pseudowires. Each PE advertises a Type 3 route (its inclusive-multicast label: the flood list) and a Type 2 route per local MAC (its unicast label).",
      "Remote MACs come from Type 2 routes only; clearing a MAC withdraws its route. A flooded frame is never sent back into the core.",
      "The transport doesn't change: every EVPN label still rides an LDP LSP, and the route target still decides who imports what.",
    ],
    more: "The engineering workspace gives you PE1–PE3, P1–P3 and RR1 in their own windows (the EVI with its flood list and MAC table, the EVPN routes, labels and LDP, an IOS XR / Junos console with commit), pings from four sites, five challenges and five tickets.",
  },
  stage,
  footer: (c) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
      <span>
        Flood-list entries: <b className="pv-mono text-pv-text">{EM_PES.reduce((n, pe) => n + floodList(c.live.view, pe).length, 0)}/6</b> · EVPN routes on RR1 {c.live.view.rrTable.length} · pseudowires 0
      </span>
      <span className="text-pv-text-faint">PE badges: local + remote MACs · CE colors match their MAC addresses in the tables</span>
    </div>
  ),
  devices: BV_ROUTERS,
  device: (id, c) => ({ label: id, icon: role(id), tone: id === "RR1" ? "#a78bfa" : "#22d3ee", sub: `${BV_LO[id as EmR]} · ${c.vendor === "cisco" ? "IOS XR" : "Junos"} view` }),
  openFrom: 1,
  window: (id, c) => <RouterUI c={c} r={id as EmR} />,
  tools: [
    { id: "cmp", label: "Compare architectures", render: (c) => <Compare c={c} /> },
    { id: "flood", label: "Flood lists", render: (c) => <Flood c={c} /> },
    { id: "routes", label: "EVPN routes", render: (c) => <Routes c={c} /> },
    { id: "bgp", label: "BGP sessions", render: (c) => <Bgp c={c} /> },
    { id: "labels", label: "EVPN labels", render: (c) => <Labels c={c} /> },
    { id: "macs", label: "MAC tables", render: (c) => <Macs c={c} /> },
    { id: "ldp", label: "LDP sessions", render: (c) => <Ldp c={c} /> },
    { id: "lsp", label: "Transport labels", render: (c) => <Lsp c={c} /> },
    { id: "path", label: "Last ping, frame by frame", render: (c) => <PathView c={c} /> },
    { id: "log", label: "Log", render: (c) => <LogTool c={c} /> },
  ],
  toolsLabel: { learn: "What the routers know", eng: "Tools" },
  evidence,
  composer: (c) => <Composer c={c} />,
  investigate: [
    "Before any ping, on RR1: show bgp l2vpn evpn (IOS XR) or show route table bgp.evpn.0 (Junos). Which routes exist already, and why only those?",
    "Ping 192.168.100.3 from CE1, then look at PE2's MAC table (show evpn evi vpn-id 100 mac / show evpn database instance EVPN-A). Which route taught PE2 where CE3 is?",
    "On PE1, compare show mpls forwarding (or show route table mpls.0) with show evpn evi vpn-id 100 detail (or show evpn instance EVPN-A extensive). Which label is for flooded frames?",
    "Clear PE3's MAC table and watch PE1's table. How fast does PE1 forget CE3 — and why is that different from a VPLS?",
    "Open the Compare architectures tool after a few pings. Which rows changed between LDP VPLS and BGP VPLS, and which only with EVPN?",
  ],
  challenges: EVO_CHALLENGES,
  tickets: EM_TICKETS.map((t) => ({ id: t.id, title: t.title, report: t.report, reproLabel: t.reproLabel, repro: t.repro })),
  ticketIntro: "Customers report symptoms, not causes. Each ticket is this network after a change with one real thing wrong. Reproduce it, walk the evidence (attachment circuits, EVPN family, Type 3 routes, Type 2 routes, transport), name the cause, fix it on the router and prove it with a fresh ping.",
  reproHint: "Watch where each frame goes — and which PEs are missing from each other's flood lists.",
  fixHint: "Fix it on the router (its console — commit to apply), check the flood lists and the routes, then run the ping again. An Established BGP session isn't proof that EVPN routes flow over it.",
  causes: EM_CAUSES,
  feedback: emCauseFeedback,
  proofs: emProofs,
  ladder: (s) => emLadder(s),
  text: (v, t) => spText(v, t),
  runCard: (c) => (
    <Card title="Result">
      <TestView c={c} />
    </Card>
  ),
};

export function EvolutionLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SpLabWorkspace spec={SPEC} open={open} onClose={onClose} />;
}
