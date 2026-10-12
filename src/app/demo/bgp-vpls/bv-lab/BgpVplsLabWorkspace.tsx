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
import { CES, IMPLICIT_NULL, VS_CES, VS_LINKS, VS_LO, VS_ROUTERS, acKey, ldpLabel, type IfName, type VsCe, type VsR } from "@/lib/sim-engine/scenarios/vsNet";
import {
  BV_CAUSES,
  BV_LO,
  BV_PES,
  BV_ROUTERS,
  BV_TICKETS,
  bvApply,
  bvCauseFeedback,
  bvLadder,
  bvProofs,
  bvWhyText,
  createBvNet,
  type BvAction,
  type BvCfg,
  type BvNlri,
  type BvR,
  type BvSnap,
  type BvState,
  type BvTicketId,
} from "@/lib/sim-engine/scenarios/bvNet";
import { bvPipe, bvSets, xrSub, type BvCliApi } from "./bvCli";
import { BV_LEVELS } from "./bvLearn";
import { BV_CHALLENGES } from "./bvPractice";

/**
 * BGP VPLS Lab — the VPLS of the previous lesson, discovered and signaled by BGP through a route reflector.
 *   LEARN                  6 levels (bvLearn): the same LAN · discovery (RD, RT, RR) · VE IDs and label blocks ·
 *                          the same data plane · when it breaks · evidence
 *   ENGINEERING WORKSPACE  Investigate (customer pings; router windows with the VPLS, the BGP table, labels and an
 *                          IOS XR / Junos console) · Challenges (five) · Troubleshoot (five tickets)
 * One model (bvNet.ts) produces every BGP route, label block, pseudowire, MAC table entry and verdict.
 */

type Ctx = SpCtx<BvState, BvAction, BvSnap>;
type Node = BvR | VsCe;
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
const isPe = (r: BvR) => (BV_PES as string[]).includes(r);
const acName = (c: Ctx, k: string) => (c.vendor === "cisco" ? xrSub(k, true) : k);
const macTone = (m: string) => ({ "00:11": "#a78bfa", "00:22": "#fbbf24", "00:33": "#34d399", "00:44": "#f472b6" })[m.slice(0, 5)] ?? "#94a3b8";
const nlriName = (n: BvNlri) => `${n.rd}:${n.veId}:${n.block.vbo}`;

function stage(c: Ctx, p: { moment?: SpMoment<BvSnap>; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) {
  const s = c.s;
  const v = c.live.view;
  const nodes: SpStageNode[] = (Object.keys(POS) as Node[]).map((d) => ({ id: d, label: d, role: role(d), tone: d.startsWith("CE") ? macTone(CES[d as VsCe].mac) : d === "RR1" ? "#a78bfa" : "#22d3ee", sub: d.startsWith("CE") ? CES[d as VsCe].ip.replace("192.168.", "…") : BV_LO[d as BvR], ...POS[d] }));
  const links: SpStageLink[] = [
    ...VS_CES.map((ce) => {
      const x = CES[ce];
      const k = acKey(x.ifn, x.vlan);
      const ac = s.cfg[x.pe].acs[k];
      const ok = !!ac && ac.vlan === x.vlan && !!s.cfg[x.pe].bd?.acs.includes(k);
      return { id: `${x.pe}-${ce}`, a: x.pe, b: ce, state: (ok ? "up" : "blocked") as SpStageLink["state"], label: ok ? "AC" : ac ? `AC VLAN ${ac.vlan ?? "?"}` : "not in VPLS" };
    }),
    ...VS_LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b, state: (v.ldp[l.id] ? "up" : "blocked") as SpStageLink["state"], label: v.ldp[l.id] ? "LDP" : "no LDP" })),
    { id: "P1-RR1", a: "P1", b: "RR1", state: "up" as SpStageLink["state"], label: "IS-IS" },
    ...BV_PES.map((pe) => ({ id: `bgp-${pe}`, a: pe, b: "RR1", state: (v.bgp[pe].l2vpn ? "standby" : "blocked") as SpStageLink["state"], label: v.bgp[pe].l2vpn ? "iBGP L2VPN" : v.bgp[pe].up ? "no L2VPN" : "BGP down" })),
    ...[["PE1", "PE2"], ["PE1", "PE3"], ["PE2", "PE3"]].map(([a, b]) => {
      const ends = v.pws.filter((x) => (x.pe === a && x.peer === b) || (x.pe === b && x.peer === a));
      const up = ends.length === 2 && ends.every((x) => x.up);
      return { id: `pw-${a}-${b}`, a, b, state: (up ? "standby" : ends.length ? "blocked" : "down") as SpStageLink["state"], label: up ? "PW" : ends.length ? "PW down" : "not discovered" };
    }),
  ];
  const views: Record<string, TopoView> = {};
  for (const pe of BV_PES) views[pe] = { badge: { text: `VE ${s.cfg[pe].bd?.veId ?? "–"} · ${(p.moment?.snap ?? c.live).fdb[pe].length} MAC`, tone: "info" } };
  views.RR1 = { badge: { text: `${v.rrTable.length} routes`, tone: "info" } };
  const paths: SpPath[] = [];
  const last = s.tests[s.tests.length - 1];
  if (last && !p.moment && last.cfgSeq === s.cfgSeq && !last.flooded) paths.push({ id: "t", nodes: last.path.filter((x, i, a) => a.indexOf(x) === i), color: last.ok ? "#34d399" : "#f87171", offset: 0 });
  return <SpStage nodes={nodes} links={links} paths={paths} views={views} moment={p.moment} momentKey={p.momentKey} compact={p.compact} onNode={p.onNode} selected={p.selected} regions={[{ x: 15, y: 8, w: 70, h: 80, label: "IS-IS + LDP core", color: "#22d3ee" }]} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------------------------
type Cell = string | [string, "ok" | "bad"];
function Pws({ c, only }: { c: Ctx; only?: BvR }) {
  const rows = c.live.view.pws
    .filter((p) => !only || p.pe === only)
    .map((p) => [p.pe, `${p.peer} (${p.ip})`, `${p.veLocal} / ${p.vePeer}`, p.local !== undefined ? String(p.local) : "—", p.remote ? String(p.remote.label) : "unknown", p.remote ? `${p.mtu} / ${p.remote.mtu}` : `${p.mtu} / ?`, p.up ? ["up", "ok"] : [bvWhyText(p, c.s.os), "bad"]] as Cell[]);
  return <STable cols={["PE", "Discovered PE", "VE local / remote", "Receives on", "Pushes", "MTU local / remote", "State"]} rows={rows} empty="No pseudowires: no PE has discovered another." />;
}
function Routes({ c, only }: { c: Ctx; only?: BvR }) {
  const v = c.live.view;
  const who: BvR[] = only ? [only] : ["RR1", ...BV_PES];
  const rows = who.flatMap((r) => {
    if (r === "RR1") return v.rrTable.map((n) => ["RR1", nlriName(n), n.pe, `RT ${n.rt}`, `${n.block.base} (+${n.block.vbs})`, ["held, reflected by client rules", "ok"]] as Cell[]);
    if (!isPe(r)) return [];
    const own = v.nlris.filter((n) => n.pe === r).map((n) => [r, nlriName(n), "local", `RT ${n.rt}`, `${n.block.base} (+${n.block.vbs})`, ["advertised", "ok"]] as Cell[]);
    const rx = v.received[r].map((n) => {
      const imp = v.imported[r].some((x) => nlriName(x) === nlriName(n) && x.block.base === n.block.base);
      return [r, nlriName(n), n.pe, `RT ${n.rt}`, `${n.block.base} (+${n.block.vbs})`, imp ? ["imported", "ok"] : [`not imported (${r} imports ${c.s.cfg[r].bd?.rt ?? "nothing"})`, "bad"]] as Cell[];
    });
    return [...own, ...rx];
  });
  return <STable cols={["Router", "Route (RD:VE:offset)", "From", "Route target", "Label base (size)", "Status"]} rows={rows} empty="No VPLS routes here." />;
}
function Bgp({ c }: { c: Ctx }) {
  const v = c.live.view;
  const rr = c.s.cfg.RR1.rr;
  const rows = BV_PES.map((pe) => {
    const cl = rr?.clients.find((x) => x.ip === BV_LO[pe]);
    return [`${pe} ↔ RR1`, v.bgp[pe].up ? ["Established", "ok"] : ["down", "bad"], v.bgp[pe].l2vpn ? ["L2VPN VPLS", "ok"] : ["not negotiated", "bad"], cl?.client ? "yes" : ["no", "bad"], String(v.received[pe].length), String(v.imported[pe].length)] as Cell[];
  });
  return <STable cols={["Session", "State", "Family", "RR client", "Routes received", "Imported"]} rows={rows} />;
}
function Labels({ c }: { c: Ctx }) {
  const v = c.live.view;
  const rows = v.nlris.map((n) => [n.pe, `VE ${n.veId}`, `${n.block.vbo}–${n.block.vbo + n.block.vbs - 1}`, `${n.block.base}–${n.block.base + n.block.vbs - 1}`, BV_PES.filter((x) => x !== n.pe && c.s.cfg[x].bd?.veId !== undefined && c.s.cfg[x].bd!.veId! >= n.block.vbo && c.s.cfg[x].bd!.veId! < n.block.vbo + n.block.vbs).map((x) => `${x} (VE ${c.s.cfg[x].bd!.veId}) → ${n.block.base + c.s.cfg[x].bd!.veId! - n.block.vbo}`).join(", ") || "—"] as string[]);
  return <STable cols={["PE", "Its VE ID", "Block covers VE IDs", "Labels", "Who sends to it with which label"]} rows={rows} empty="No PE advertises a label block." />;
}
function Macs({ c, only }: { c: Ctx; only?: BvR }) {
  const fdb = c.live.fdb;
  const owner = (mac: string) => VS_CES.find((x) => CES[x].mac === mac) ?? "?";
  const rows = BV_PES.filter((pe) => !only || pe === only).flatMap((pe) => fdb[pe].map((m) => [pe, m.mac, owner(m.mac), m.port.startsWith("pw:") ? `pseudowire to ${m.port.slice(3)}` : acName(c, m.port)] as string[]));
  return <STable cols={["PE", "MAC", "Belongs to", "Learned on"]} rows={rows} empty="Empty: nothing has been sent since the tables were cleared." />;
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
      {bvLadder(c.s).map((r, i) => (
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
    case "pws":
      return card("The pseudowire mesh (built from BGP)", <Pws c={c} />);
    case "routes":
      return card("VPLS routes in BGP", <Routes c={c} />);
    case "bgp":
      return card("BGP sessions to the route reflector", <Bgp c={c} />);
    case "labels":
      return card("Label blocks", <Labels c={c} />);
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
function cfgDiff(a: BvCfg, b: BvCfg): string {
  const out: string[] = [];
  for (const k of new Set([...Object.keys(a.acs), ...Object.keys(b.acs)])) {
    if (!a.acs[k]) out.push(`${k} created`);
    else if (!b.acs[k]) out.push(`${k} removed`);
    else if (JSON.stringify(a.acs[k]) !== JSON.stringify(b.acs[k])) out.push(`${k} changed`);
  }
  if (!a.bd && b.bd) out.push(`VPLS ${b.bd.name} created`);
  else if (a.bd && !b.bd) out.push(`VPLS ${a.bd.name} removed`);
  else if (a.bd && b.bd) {
    const keys = ["rd", "rt", "veId", "mtu", "blockSize", "vpnId"] as const;
    const label: Record<(typeof keys)[number], string> = { rd: "RD", rt: "RT", veId: "VE ID", mtu: "MTU", blockSize: "label block size", vpnId: "VPN ID" };
    for (const k of keys) if (a.bd[k] !== b.bd[k]) out.push(`VPLS ${label[k]} ${b.bd[k] ?? "removed"}`);
    if (a.bd.acs.join() !== b.bd.acs.join()) out.push("VPLS interfaces changed");
    if (a.bd.vfi !== b.bd.vfi || a.bd.ad !== b.bd.ad || a.bd.sig !== b.bd.sig) out.push("VFI / BGP discovery and signaling changed");
  }
  if (JSON.stringify(a.nbr) !== JSON.stringify(b.nbr)) out.push(b.nbr ? `BGP neighbor ${b.nbr.ip}${b.nbr.l2vpn ? " (L2VPN)" : " (no L2VPN family)"}` : "BGP neighbor removed");
  if (JSON.stringify(a.rr) !== JSON.stringify(b.rr)) out.push("route-reflector clients changed");
  for (const k of new Set([...Object.keys(a.ldp), ...Object.keys(b.ldp)]) as Set<IfName>) if (!!a.ldp[k] !== !!b.ldp[k]) out.push(`${k} LDP ${b.ldp[k] ? "on" : "off"}`);
  return out.join(", ") || "no change";
}
function devCli(c: Ctx, r: BvR): SpDevCli<BvCfg> {
  return {
    host: r,
    running: c.s.cfg[r],
    hist: c.s.hist[r],
    cand: c.cli.cand[r] as BvCfg | undefined,
    setCand: (x) => c.cli.setCand(r, x),
    xr: c.cli.xr[r] ?? [],
    setXr: (st) => c.cli.setXr(r, st),
    edit: !!c.cli.edit[r],
    setEdit: (b) => c.cli.setEdit(r, b),
    commit: (cfg, how) => c.act({ type: "cfg", dev: r, cfg, text: `${cfgDiff(c.s.cfg[r], cfg)} (${how}, ${c.vendor === "cisco" ? "IOS XR" : "Junos"})` }),
    ask: c.cli.setQuestion,
  };
}
type Tab = "vpls" | "bgp" | "labels" | "term" | "log";
function RouterUI({ c, r }: { c: Ctx; r: BvR }) {
  const pe = isPe(r);
  const rr = r === "RR1";
  const [tab, setTab] = useState<Tab>(pe ? "vpls" : rr ? "bgp" : "labels");
  const s = c.s;
  const cfg = s.cfg[r];
  const change = (f: (x: BvCfg) => void) => {
    const n = spClone(cfg);
    f(n);
    c.act({ type: "cfg", dev: r, cfg: n, text: `${cfgDiff(cfg, n)} (from ${r}'s window)` });
  };
  const api: BvCliApi = { s, act: c.act, dev: devCli(c, r) };
  const tabs: [Tab, string][] = [...(pe ? ([["vpls", "VPLS"]] as [Tab, string][]) : []), ...(pe || rr ? ([["bgp", "BGP"]] as [Tab, string][]) : []), ...(!rr ? ([["labels", "Labels & LDP"]] as [Tab, string][]) : []), ["term", "Console"], ["log", "Log"]];
  return (
    <div>
      <Tabs tabs={tabs} cur={tab} set={setTab} />
      <div className="space-y-2 p-3">
        {tab === "vpls" && pe && (
          <>
            <Card title={cfg.bd ? `${c.vendor === "cisco" ? `bridge group ${cfg.bd.group} · bridge-domain` : "routing-instance"} ${cfg.bd.name}` : "No VPLS configured"}>
              {cfg.bd && (
                <div className="grid gap-x-4 sm:grid-cols-2">
                  <Kv k="Attachment circuits" v={cfg.bd.acs.map((k) => `${acName(c, k)} · VLAN ${cfg.acs[k]?.vlan ?? "none"}`).join(", ") || "none"} tone={cfg.bd.acs.length ? undefined : "warn"} />
                  <Kv k="RD" v={cfg.bd.rd ?? "none"} tone={cfg.bd.rd ? undefined : "warn"} />
                  <Kv k="RT" v={cfg.bd.rt ?? "none"} tone={cfg.bd.rt ? undefined : "warn"} />
                  <Kv k={c.vendor === "cisco" ? "VE ID" : "Site identifier (VE ID)"} v={String(cfg.bd.veId ?? "none")} tone={cfg.bd.veId !== undefined ? undefined : "warn"} />
                  <Kv k={c.vendor === "cisco" ? "VE range (block size)" : "Label block size"} v={String(cfg.bd.blockSize)} />
                  <Kv k="MTU" v={String(cfg.bd.mtu)} />
                  {c.vendor === "cisco" && <Kv k="VFI · discovery · signaling" v={`${cfg.bd.vfi ? `VFI, VPN ID ${cfg.bd.vpnId ?? "none"}` : "no VFI"} · ${cfg.bd.ad ? "BGP" : "none"} · ${cfg.bd.sig ? "BGP" : "none"}`} tone={cfg.bd.vfi && cfg.bd.ad && cfg.bd.sig ? undefined : "warn"} />}
                </div>
              )}
            </Card>
            <Pws c={c} only={r} />
            <Macs c={c} only={r} />
            <div className="flex flex-wrap items-center gap-2">
              <Pill onClick={() => c.act({ type: "clear", dev: r as VsR })} disabled={c.busy}>
                Clear {r}&apos;s MAC table
              </Pill>
              <span className="text-[11.5px] text-pv-text-faint">The VPLS itself is configured in the Console (candidate + commit).</span>
            </div>
          </>
        )}
        {tab === "bgp" && (pe || rr) && (
          <>
            {rr ? (
              <Card title={`RR1 · cluster ${"100.100.100.100"}`}>
                <STable cols={["Neighbor", "L2VPN VPLS", "Route-reflector client"]} rows={(cfg.rr?.clients ?? []).map((x) => [x.ip, x.l2vpn ? "yes" : ["no", "bad"], x.client ? "yes" : ["no", "bad"]] as Cell[])} empty="No neighbors." />
              </Card>
            ) : (
              <Card title="BGP">
                <Kv k="Neighbor" v={cfg.nbr ? `${cfg.nbr.ip} (RR1)` : "none"} tone={cfg.nbr ? undefined : "warn"} />
                <Kv k="L2VPN VPLS family" v={c.live.view.bgp[r].l2vpn ? "negotiated" : cfg.nbr?.l2vpn ? "configured here, not negotiated" : "not configured"} tone={c.live.view.bgp[r].l2vpn ? undefined : "warn"} />
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
        {tab === "term" && <SpConsole c={c.cli} sets={bvSets(api, r)} os={c.vendor === "cisco" ? "iosxr" : "junos"} host={r} vendor={c.vendor} setVendor={c.setVendor} pipeCtx={c.vendor === "juniper" ? bvPipe(api, r) : undefined} />}
        {tab === "log" && (
          <ul className="space-y-0.5">
            {s.sys.filter((x) => x.dev === r).slice(-30).reverse().map((x, i) => (
              <li key={i} className="pv-mono text-[11.5px] text-pv-text-muted">
                {spStamp(x.t).hms}{" "}
                {x.kind === "commit" ? "configuration committed" : x.kind === "clear" ? "MAC table cleared" : x.kind.startsWith("pw") ? `pseudowire to ${x.peer} ${x.kind === "pw-up" ? "up" : "down"}` : x.kind.startsWith("bgp") ? `BGP ${x.peer} ${x.kind === "bgp-up" ? "Established" : "down"}` : `LDP ${x.peer} ${x.kind === "ldp-up" ? "up" : "down"}`}
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
            Wipe PE3&apos;s VPLS
          </Pill>
          <span className="text-[11.5px] text-pv-text-faint">for challenge 4</span>
        </div>
      )}
    </div>
  );
}

const SPEC: SpLabSpec<BvState, BvAction, BvSnap> = {
  title: "BGP VPLS Lab",
  note: () => "three PEs · one route reflector · discovered and signaled by BGP",
  fresh: (seq, vendor) => createBvNet(seq, vendor === "cisco" ? "xr" : "junos"),
  vendorAction: (v) => ({ type: "os", os: v === "cisco" ? "xr" : "junos" }),
  apply: bvApply,
  snapOf: (s) => ({ view: s.view, fdb: s.fdb }),
  ticketAction: (id) => ({ type: "ticket", id: id as BvTicketId }),
  levels: BV_LEVELS,
  gate: {
    title: "You can read a BGP-signaled VPLS",
    points: [
      "Each PE advertises one BGP route per VPLS (per label block): RD to make it unique, RT to say which VPLS, VE ID and label block to signal.",
      "A PE that imports the RT has discovered the advertiser — no neighbor statements, one session to the route reflector.",
      "The route reflector reflects only for its clients; the L2VPN family must be negotiated on every session.",
      "Labels come from blocks: label = base + sender's VE ID − block offset. VE IDs must be unique; blocks grow on their own.",
      "Once the pseudowires are up, the data plane is the VPLS you know — and it still needs an LSP underneath.",
    ],
    more: "The engineering workspace gives you PE1–PE3, P1–P3 and RR1 in their own windows (the VPLS with its MAC table, the BGP table, labels and LDP, an IOS XR / Junos console with commit), pings from four sites, five challenges and five tickets.",
  },
  stage,
  footer: (c) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
      <span>
        Pseudowires up: <b className="pv-mono text-pv-text">{c.s.view.pws.filter((p) => p.up).length}/{c.s.view.pws.length}</b> · VPLS routes on RR1 {c.s.view.rrTable.length} · MACs learned {BV_PES.reduce((n, pe) => n + c.live.fdb[pe].length, 0)}
      </span>
      <span className="text-pv-text-faint">CE colors match their MAC addresses in the tables</span>
    </div>
  ),
  devices: BV_ROUTERS,
  device: (id, c) => ({ label: id, icon: role(id), tone: id === "RR1" ? "#a78bfa" : "#22d3ee", sub: `${BV_LO[id as BvR]} · ${c.vendor === "cisco" ? "IOS XR" : "Junos"} view` }),
  openFrom: 1,
  window: (id, c) => <RouterUI c={c} r={id as BvR} />,
  tools: [
    { id: "pws", label: "Pseudowires", render: (c) => <Pws c={c} /> },
    { id: "routes", label: "VPLS routes", render: (c) => <Routes c={c} /> },
    { id: "bgp", label: "BGP sessions", render: (c) => <Bgp c={c} /> },
    { id: "labels", label: "Label blocks", render: (c) => <Labels c={c} /> },
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
    "On RR1, show bgp l2vpn vpls (IOS XR) or show route table bgp.l2vpn.0 (Junos): one route per PE. Which part of each route is the RD, which the VE ID, which the block offset?",
    "On PE1, show l2vpn bridge-domain detail or show vpls connections: check that every label PE1 receives on equals its block base + the sender's VE ID − 1.",
    "Give PE3 VE ID 12 and compare the routes on RR1 before and after. Who added a block, and why?",
    "On P1, try show bgp l2vpn vpls. Why is BGP not running there?",
    "On RR1, show the bridge domain or the MAC table. Why is there nothing to show?",
  ],
  challenges: BV_CHALLENGES,
  tickets: BV_TICKETS.map((t) => ({ id: t.id, title: t.title, report: t.report, reproLabel: t.reproLabel, repro: t.repro })),
  ticketIntro: "Customers report symptoms, not causes. Each ticket is this network after a change with one real thing wrong. Reproduce it, walk the evidence (attachment circuits, BGP family, discovery, pseudowires and labels, transport), name the cause, fix it on the router and prove it with a fresh ping.",
  reproHint: "Watch where each frame goes — and which PEs never discovered each other.",
  fixHint: "Fix it on the router (its console — commit to apply), check the routes and the pseudowires, then run the ping again. An Established BGP session isn't proof that VPLS routes flow over it.",
  causes: BV_CAUSES,
  feedback: bvCauseFeedback,
  proofs: bvProofs,
  ladder: (s) => bvLadder(s),
  text: (v, t) => spText(v, t),
  runCard: (c) => (
    <Card title="Result">
      <TestView c={c} />
    </Card>
  ),
};

export function BgpVplsLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SpLabWorkspace spec={SPEC} open={open} onClose={onClose} />;
}
