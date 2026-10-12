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
  CES,
  IMPLICIT_NULL,
  L3_CAUSES,
  L3_CES,
  L3_LINKS,
  L3_LO,
  L3_PES,
  L3_ROUTERS,
  L3_TICKETS,
  ceIfs,
  createL3Net,
  l3Apply,
  l3CauseFeedback,
  l3Forward,
  l3Ladder,
  l3Proofs,
  ldpLabel,
  type IfName,
  type L3Action,
  type L3Ce,
  type L3Cfg,
  type L3R,
  type L3Snap,
  type L3State,
  type L3TicketId,
  vrfImports,
} from "@/lib/sim-engine/scenarios/l3Net";
import { l3Pipe, l3Sets, type L3CliApi } from "./l3Cli";
import { L3_LEVELS } from "./l3Learn";
import { L3_CHALLENGES } from "./l3Practice";

/**
 * MPLS L3VPN Lab — two customers with the same addresses over one provider core, on the shared SP lab workspace.
 *   LEARN                  6 levels (l3Learn): VRFs · RD and RT · MP-BGP · two labels · the transport LSP · evidence
 *   ENGINEERING WORKSPACE  Investigate (customer pings; router windows with VRFs, VPNv4 routes, labels and an
 *                          IOS XR / Junos console) · Challenges (five) · Troubleshoot (five tickets)
 * One model (l3Net.ts) produces every VRF table, VPNv4 route, label and verdict.
 */

type Ctx = SpCtx<L3State, L3Action, L3Snap>;
type Node = L3R | L3Ce;
const POS: Record<Node, { x: number; y: number; cx: number; cy: number }> = {
  CE1A: { x: 6, y: 24, cx: 8, cy: 14 },
  CE1B: { x: 6, y: 76, cx: 8, cy: 86 },
  PE1: { x: 22, y: 50, cx: 20, cy: 50 },
  P1: { x: 40, y: 50, cx: 38, cy: 50 },
  P2: { x: 58, y: 50, cx: 58, cy: 50 },
  PE2: { x: 76, y: 50, cx: 78, cy: 50 },
  CE2A: { x: 94, y: 18, cx: 92, cy: 12 },
  CE2B: { x: 94, y: 50, cx: 94, cy: 34 },
  CE2S: { x: 94, y: 82, cx: 92, cy: 88 },
};
const VRF_TONE: Record<string, string> = { "CUST-A": "#a78bfa", "CUST-B": "#fbbf24", SHARED: "#34d399" };
const role = (d: string) => (d.startsWith("CE") ? "CE" : d.startsWith("PE") ? "PE" : "P");

function stage(c: Ctx, p: { moment?: SpMoment<L3Snap>; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) {
  const s = c.s;
  const v = c.live.view;
  const nodes: SpStageNode[] = (Object.keys(POS) as Node[]).map((d) => ({ id: d, label: d, role: role(d), tone: d.startsWith("CE") ? VRF_TONE[CES[d as L3Ce].vrf] : "#22d3ee", sub: d.startsWith("CE") ? CES[d as L3Ce].nets[0].replace("/24", "") : L3_LO[d as L3R], ...POS[d] }));
  const links: SpStageLink[] = [
    ...L3_CES.map((ce) => {
      const x = CES[ce];
      const ic = s.cfg[x.pe].ifs[x.ifn];
      const inVrf = ic?.vrf === x.vrf;
      return { id: `${x.pe}-${ce}`, a: x.pe, b: ce, state: (ic?.shut ? "down" : inVrf ? "up" : "blocked") as SpStageLink["state"], label: ic?.shut ? "down" : inVrf ? x.vrf : "global table" };
    }),
    ...L3_LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b, state: (v.ldp[l.id] ? "up" : "blocked") as SpStageLink["state"], label: v.ldp[l.id] ? "LDP" : "no LDP" })),
    { id: "PE1-PE2", a: "PE1", b: "PE2", state: (v.vpnv4Up ? "standby" : v.bgpUp ? "blocked" : "down") as SpStageLink["state"], label: v.vpnv4Up ? "iBGP VPNv4" : v.bgpUp ? "iBGP, no VPNv4" : "iBGP down" },
  ];
  const views: Record<string, TopoView> = {};
  for (const pe of L3_PES) views[pe] = { badge: { text: `${Object.keys(s.cfg[pe].vrfs).length} VRF`, tone: "info" } };
  const paths: SpPath[] = [];
  const last = s.tests[s.tests.length - 1];
  if (last && !p.moment && last.cfgSeq === s.cfgSeq) paths.push({ id: "t", nodes: last.path, color: last.ok ? "#34d399" : "#f87171", offset: 0 });
  return <SpStage nodes={nodes} links={links} paths={paths} views={views} moment={p.moment} momentKey={p.momentKey} compact={p.compact} onNode={p.onNode} selected={p.selected} regions={[{ x: 15, y: 30, w: 68, h: 40, label: "provider core · AS 65000 · IS-IS + LDP", color: "#22d3ee" }]} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------------------------
function Vrfs({ c, only }: { c: Ctx; only?: L3R }) {
  const rows = L3_PES.filter((pe) => !only || pe === only).flatMap((pe) =>
    c.live.view.vrfRoutes[pe]
      .filter((r) => r.via !== "connected")
      .map((r) => [pe, [r.vrf, "hi"], r.prefix, r.via === "static" ? `static via ${r.nh}` : r.from === pe ? `BGP, from VRF ${r.srcVrf}` : `BGP via ${r.nh}`, r.label ? String(r.label) : "—", r.hidden ? ["hidden: no LSP", "bad"] : ["usable", "ok"]] as (string | [string, "hi" | "ok" | "bad"])[]),
  );
  return <STable cols={["PE", "VRF", "Prefix", "Learned", "VPN label", "State"]} rows={rows} empty="No VRF routes." />;
}
function Vpnv4({ c }: { c: Ctx }) {
  const v = c.live.view;
  const rows = v.vpnv4.map((x) => {
    const other: L3R = x.pe === "PE1" ? "PE2" : "PE1";
    const into = Object.entries(c.s.cfg[other].vrfs).filter(([, cfg]) => x.rts.some((rt) => vrfImports(c.s.cfg[other], cfg).includes(rt))).map(([n]) => n);
    return [x.pe, `${x.rd}:${x.prefix}`, x.rts.join(" ") || "—", String(x.label), x.nh, !v.vpnv4Up ? ["not exchanged", "bad"] : into.length ? [`imported into ${into.join(", ")}`, "ok"] : ["discarded (no VRF imports its RT)", "warn"]] as (string | [string, "ok" | "bad" | "warn"])[];
  });
  return <STable cols={["From", "RD:prefix", "Route targets", "VPN label", "Next hop", `At the other PE`]} rows={rows} empty="No VPNv4 routes." />;
}
function Lsp({ c }: { c: Ctx }) {
  const v = c.live.view;
  const rows = L3_ROUTERS.flatMap((r) =>
    [L3_LO.PE1, L3_LO.PE2].filter((fec) => L3_LO[r] !== fec).map((fec) => {
      const t = v.lsp[r][fec];
      return [r, `${fec}/32`, String(ldpLabel(c.s.os, r, fec)), t?.out === undefined ? ["none (Unlabelled)", "bad"] : t.out === IMPLICIT_NULL ? "pop (PHP)" : String(t.out), t?.nh ?? "—"] as (string | [string, "bad"])[];
    }),
  );
  return <STable cols={["Router", "FEC", "Local label", "Outgoing label", "Toward"]} rows={rows} />;
}
function PathView({ c }: { c: Ctx }) {
  const t = c.s.tests[c.s.tests.length - 1];
  if (!t) return <p className="text-[12px] text-pv-text-faint">Run a ping above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The stack appears when the run has finished.</p>;
  const tr = l3Forward(c.s.cfg, c.s.view, c.s.os, t.from, t.dst);
  return <STable cols={["Hop", "Label stack (top first)", "What happened"]} rows={tr.hops.map((h) => [`${h.from} → ${h.to}`, h.labels.length ? h.labels.join(" / ") : "IP", h.note])} />;
}
function TestView({ c }: { c: Ctx }) {
  const t = c.s.tests[c.s.tests.length - 1];
  if (!t) return <p className="text-[12px] text-pv-text-faint">Run a ping above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The result appears when the run has finished.</p>;
  return (
    <div className={clsx("rounded-lg border px-2 py-1 text-[12.5px]", t.ok ? "border-pv-success/40" : "border-pv-danger/40")}>
      <p className="font-semibold text-pv-text">
        ping {t.dst} from {t.from}: <span className={t.ok ? "text-pv-success" : "text-pv-danger"}>{t.ok ? `success — reached ${t.reached}` : "failed"}</span>
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
      {l3Ladder(c.s).map((r, i) => (
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
    case "vrfs":
      return card("VRF tables on the PEs", <Vrfs c={c} />);
    case "vpnv4":
      return card("VPNv4 routes between the PEs", <Vpnv4 c={c} />);
    case "lsp":
      return card("Transport labels (LDP)", <Lsp c={c} />);
    case "path":
      return card("The label stack, hop by hop", <PathView c={c} />);
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
function cfgDiff(a: L3Cfg, b: L3Cfg): string {
  const out: string[] = [];
  for (const k of Object.keys(b.ifs) as IfName[]) {
    const x = a.ifs[k];
    const y = b.ifs[k]!;
    if (!x) continue;
    if (x.vrf !== y.vrf) out.push(`${k} ${y.vrf ? `in VRF ${y.vrf}` : "in the global table"}`);
    if (x.ldp !== y.ldp) out.push(`${k} LDP ${y.ldp ? "on" : "off"}`);
    if (x.shut !== y.shut) out.push(`${k} ${y.shut ? "shutdown" : "no shutdown"}`);
  }
  for (const [n, v] of Object.entries(b.vrfs)) {
    const o = a.vrfs[n];
    if (!o) out.push(`VRF ${n} created`);
    else if (JSON.stringify(o) !== JSON.stringify(v)) out.push(`VRF ${n} changed`);
  }
  for (const n of Object.keys(a.vrfs)) if (!b.vrfs[n]) out.push(`VRF ${n} removed`);
  if (JSON.stringify(a.nbr) !== JSON.stringify(b.nbr)) out.push(`BGP neighbor ${b.nbr ? `${b.nbr.ip}${b.nbr.vpnv4 ? " (VPNv4)" : " (no VPNv4)"}` : "removed"}`);
  return out.join(", ") || "no change";
}
function devCli(c: Ctx, r: L3R): SpDevCli<L3Cfg> {
  return {
    host: r,
    running: c.s.cfg[r],
    hist: c.s.hist[r],
    cand: c.cli.cand[r] as L3Cfg | undefined,
    setCand: (x) => c.cli.setCand(r, x),
    xr: c.cli.xr[r] ?? [],
    setXr: (st) => c.cli.setXr(r, st),
    edit: !!c.cli.edit[r],
    setEdit: (b) => c.cli.setEdit(r, b),
    commit: (cfg, how) => c.act({ type: "cfg", dev: r, cfg, text: `${cfgDiff(c.s.cfg[r], cfg)} (${how}, ${c.vendor === "cisco" ? "IOS XR" : "Junos"})` }),
    ask: c.cli.setQuestion,
  };
}
function RouterUI({ c, r }: { c: Ctx; r: L3R }) {
  const pe = L3_PES.includes(r);
  const [tab, setTab] = useState<"vrf" | "labels" | "term" | "log">(pe ? "vrf" : "labels");
  const s = c.s;
  const cfg = s.cfg[r];
  const change = (f: (x: L3Cfg) => void) => {
    const n = spClone(cfg);
    f(n);
    c.act({ type: "cfg", dev: r, cfg: n, text: `${cfgDiff(cfg, n)} (from ${r}'s window)` });
  };
  const api: L3CliApi = { s, act: c.act, dev: devCli(c, r) };
  return (
    <div>
      <Tabs tabs={[...(pe ? ([["vrf", "VRFs"]] as ["vrf", string][]) : []), ["labels", "Labels & LDP"], ["term", "Console"], ["log", "Log"]]} cur={tab} set={setTab} />
      <div className="space-y-2 p-3">
        {tab === "vrf" && pe && (
          <>
            {Object.entries(cfg.vrfs).map(([n, v]) => (
              <Card key={n} title={<span style={{ color: VRF_TONE[n] }}>VRF {n}</span>}>
                <div className="grid gap-x-4 sm:grid-cols-2">
                  <Kv k="RD" v={v.rd ?? "not set"} tone={v.rd ? undefined : "bad"} />
                  <Kv k="Import / export RT" v={`${vrfImports(cfg, v).join(" ") || "—"}${v.vrfImport ? ` (policy ${v.vrfImport})` : ""} / ${v.exp.join(" ") || "—"}`} />
                  <Kv k="Interfaces" v={ceIfs(r).filter((x) => cfg.ifs[x.ifn]?.vrf === n).map((x) => `${ifName(c.vendor, x.ifn)} → ${x.ce}`).join(", ") || "none"} tone={ceIfs(r).some((x) => cfg.ifs[x.ifn]?.vrf === n) ? undefined : "warn"} />
                  <Kv k="Labels" v={v.perVrfLabel ? "one per VRF" : "one per prefix"} />
                </div>
              </Card>
            ))}
            <Vrfs c={c} only={r} />
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="text-pv-text-muted">iBGP to {cfg.nbr?.ip ?? "—"}:</span>
              <label className="flex items-center gap-1 text-pv-text">
                <input type="checkbox" aria-label="vpnv4" checked={!!cfg.nbr?.vpnv4} disabled={c.busy || !cfg.nbr} onChange={(e) => change((x) => void (x.nbr && (x.nbr.vpnv4 = e.target.checked)))} />
                VPNv4 family
              </label>
            </div>
            <p className="text-[11.5px] text-pv-text-faint">VRFs, route targets, interfaces and static routes are configured in the Console (candidate + commit).</p>
          </>
        )}
        {tab === "labels" && (
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
                  {L3_LINKS.filter((l) => l.a === r || l.b === r).map((l) => {
                    const ifn = l.a === r ? l.ai : l.bi;
                    const peer = l.a === r ? l.b : l.a;
                    return (
                      <tr key={l.id} className="border-t border-pv-border/40">
                        <td className="px-1 py-0.5 pv-mono text-pv-text">{ifName(c.vendor, ifn)}</td>
                        <td className="px-1 text-pv-text-muted">{peer}</td>
                        <td className="px-1">
                          <input type="checkbox" aria-label={`ldp ${ifn}`} checked={!!cfg.ifs[ifn]?.ldp} disabled={c.busy} onChange={(e) => change((x) => void (x.ifs[ifn]!.ldp = e.target.checked))} />
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
        {tab === "term" && <SpConsole c={c.cli} sets={l3Sets(api, r)} os={c.vendor === "cisco" ? "iosxr" : "junos"} host={r} vendor={c.vendor} setVendor={c.setVendor} pipeCtx={c.vendor === "juniper" ? l3Pipe(api, r) : undefined} />}
        {tab === "log" && (
          <ul className="space-y-0.5">
            {s.sys.filter((x) => x.dev === r).slice(-30).reverse().map((x, i) => (
              <li key={i} className="pv-mono text-[11.5px] text-pv-text-muted">
                {spStamp(x.t).hms} {x.kind === "commit" ? "configuration committed" : x.kind.startsWith("bgp") ? `BGP ${x.peer} ${x.kind === "bgp-up" ? "Established" : "down"}` : `LDP ${x.peer} ${x.kind === "ldp-up" ? "up" : "down"}`}
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
const HOSTS = ["10.1.1.10", "10.1.2.10", "10.2.2.20", "10.9.9.10"];
function Composer({ c }: { c: Ctx }) {
  const [from, setFrom] = useState<L3Ce>("CE1A");
  const [to, setTo] = useState("10.2.2.20");
  const sel = "rounded border border-pv-border bg-pv-bg px-1 py-0.5 text-[12px] text-pv-text";
  return (
    <div className="space-y-2 rounded-xl border border-pv-border p-2">
      <p className="text-[12px] font-semibold text-pv-text">Customer traffic</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <select aria-label="From" className={sel} value={from} onChange={(e) => setFrom(e.target.value as L3Ce)}>
          {L3_CES.map((x) => (
            <option key={x} value={x}>
              {x} ({CES[x].vrf})
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
      </div>
      {!c.s.ticket && (
        <div className="flex flex-wrap items-center gap-2">
          <Pill onClick={() => c.act({ type: "wipe-b" })} disabled={c.busy || !!c.s.wiped} tone="danger">
            Wipe PE2&apos;s CUST-B
          </Pill>
          <span className="text-[11.5px] text-pv-text-faint">for challenge 5</span>
        </div>
      )}
    </div>
  );
}

const SPEC: SpLabSpec<L3State, L3Action, L3Snap> = {
  title: "L3VPN Lab",
  note: () => "CUST-A and CUST-B · same addresses · PE1 ↔ PE2",
  fresh: (seq, vendor) => createL3Net(seq, vendor === "cisco" ? "xr" : "junos"),
  vendorAction: (v) => ({ type: "os", os: v === "cisco" ? "xr" : "junos" }),
  apply: l3Apply,
  snapOf: (s) => ({ view: s.view }),
  ticketAction: (id) => ({ type: "ticket", id: id as L3TicketId }),
  levels: L3_LEVELS,
  gate: {
    title: "You can follow a customer packet through an MPLS L3VPN",
    points: [
      "Each customer gets a VRF on the PE; the interface a packet arrives on decides which table is used.",
      "The RD makes identical prefixes unique in BGP; route targets decide which VRFs import them.",
      "MP-BGP VPNv4 between the PE loopbacks carries every customer's routes, each with a VPN label from the egress PE.",
      "The ingress PE pushes the VPN label and the transport label; the core switches only the transport label.",
      "If the transport LSP breaks, VPN traffic dies even though loopback pings and BGP still work.",
    ],
    more: "The engineering workspace gives you PE1, P1, P2 and PE2 in their own windows (VRFs and their tables, labels and LDP, an IOS XR / Junos console with commit), customer pings from every site, five challenges and five tickets.",
  },
  stage,
  footer: (c) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
      <span>
        VPNv4: <b className="pv-mono text-pv-text">{c.s.view.vpnv4Up ? "up" : "down"}</b> · routes {c.s.view.vpnv4.length}
      </span>
      <span className="text-pv-text-faint">CE colors: violet CUST-A · amber CUST-B · green SHARED</span>
    </div>
  ),
  devices: L3_ROUTERS,
  device: (id, c) => ({ label: id, icon: role(id), tone: "#22d3ee", sub: `${L3_LO[id as L3R]} · ${c.vendor === "cisco" ? "IOS XR" : "Junos"} view` }),
  openFrom: 1,
  window: (id, c) => <RouterUI c={c} r={id as L3R} />,
  tools: [
    { id: "vrfs", label: "VRF tables", render: (c) => <Vrfs c={c} /> },
    { id: "vpnv4", label: "VPNv4", render: (c) => <Vpnv4 c={c} /> },
    { id: "lsp", label: "Transport labels", render: (c) => <Lsp c={c} /> },
    { id: "path", label: "Last label stack", render: (c) => <PathView c={c} /> },
    { id: "log", label: "Log", render: (c) => <LogTool c={c} /> },
  ],
  toolsLabel: { learn: "What the routers know", eng: "Tools" },
  evidence,
  composer: (c) => <Composer c={c} />,
  investigate: [
    "On PE1, compare show route vrf CUST-A and show route vrf CUST-B (IOS XR) — or show route table CUST-A.inet.0 (Junos). Same prefixes, different next hops and labels.",
    "Read one VPNv4 route in detail: show bgp vpnv4 unicast rd 65001:102 10.2.2.0/24 / show route table bgp.l3vpn.0 detail.",
    "show cef vrf CUST-A 10.2.2.20 on PE1: which two labels does it impose, and who chose each?",
    "On P1, try show bgp vpnv4 unicast. Why is there nothing to show?",
    "Remove one VRF's import route target and watch the route disappear from that VRF only.",
  ],
  challenges: L3_CHALLENGES,
  tickets: L3_TICKETS.map((t) => ({ id: t.id, title: t.title, report: t.report, reproLabel: t.reproLabel, repro: t.repro })),
  ticketIntro: "Customers report symptoms, not causes. Each ticket is this network after a change with one real thing wrong. Reproduce it, walk the evidence (the VRF, VPNv4, the VRF tables, the transport LSP), name the cause, fix it on the router and prove it with a fresh ping.",
  reproHint: "Watch where the packet stops and what each router's table says.",
  fixHint: "Fix it on the router (its window, or its console — commit to apply), check the VRF tables, then run the ping again. An accepted command isn't a repaired VPN.",
  causes: L3_CAUSES,
  feedback: l3CauseFeedback,
  proofs: l3Proofs,
  ladder: (s) => l3Ladder(s),
  text: (v, t) => spText(v, t),
  runCard: (c) => (
    <Card title="Result">
      <TestView c={c} />
    </Card>
  ),
};

export function L3vpnLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SpLabWorkspace spec={SPEC} open={open} onClose={onClose} />;
}
