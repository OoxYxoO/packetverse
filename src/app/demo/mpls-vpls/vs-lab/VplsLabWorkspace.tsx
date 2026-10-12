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
  VS_CAUSES,
  VS_CES,
  VS_LINKS,
  VS_LO,
  VS_PES,
  VS_ROUTERS,
  VS_TICKETS,
  acKey,
  createVsNet,
  ldpLabel,
  pairKey,
  pwWhyText,
  vsApply,
  vsCauseFeedback,
  vsLadder,
  vsProofs,
  type IfName,
  type VsAction,
  type VsCe,
  type VsCfg,
  type VsR,
  type VsSnap,
  type VsState,
  type VsTicketId,
} from "@/lib/sim-engine/scenarios/vsNet";
import { vsPipe, vsSets, xrSub, type VsCliApi } from "./vsCli";
import { VS_LEVELS } from "./vsLearn";
import { VS_CHALLENGES } from "./vsPractice";

/**
 * VPLS Lab — one multipoint Ethernet service across three PEs, on the shared SP lab workspace.
 *   LEARN                  6 levels (vsLearn): one LAN · learning and flooding · split horizon and the full mesh ·
 *                          two labels · the transport underneath · evidence
 *   ENGINEERING WORKSPACE  Investigate (customer pings; router windows with the bridge, MAC table, labels and an
 *                          IOS XR / Junos console) · Challenges (five) · Troubleshoot (five tickets)
 * One model (vsNet.ts) produces every pseudowire, MAC table entry, label and verdict.
 */

type Ctx = SpCtx<VsState, VsAction, VsSnap>;
type Node = VsR | VsCe;
const POS: Record<Node, { x: number; y: number; cx: number; cy: number }> = {
  CE1: { x: 6, y: 50, cx: 6, cy: 36 },
  PE1: { x: 22, y: 50, cx: 22, cy: 36 },
  P1: { x: 40, y: 50, cx: 40, cy: 36 },
  P2: { x: 58, y: 24, cx: 58, cy: 12 },
  P3: { x: 58, y: 76, cx: 58, cy: 90 },
  PE2: { x: 77, y: 24, cx: 77, cy: 12 },
  PE3: { x: 77, y: 76, cx: 77, cy: 90 },
  CE2: { x: 94, y: 12, cx: 94, cy: 2 },
  CE4: { x: 94, y: 38, cx: 94, cy: 50 },
  CE3: { x: 94, y: 76, cx: 94, cy: 90 },
};
const role = (d: string) => (d.startsWith("CE") ? "CE" : d.startsWith("PE") ? "PE" : "P");
const acName = (c: Ctx, k: string) => (c.vendor === "cisco" ? xrSub(k, true) : k);
const macTone = (m: string) => ({ "00:11": "#a78bfa", "00:22": "#fbbf24", "00:33": "#34d399", "00:44": "#f472b6" })[m.slice(0, 5)] ?? "#94a3b8";

function stage(c: Ctx, p: { moment?: SpMoment<VsSnap>; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) {
  const s = c.s;
  const v = c.live.view;
  const nodes: SpStageNode[] = (Object.keys(POS) as Node[]).map((d) => ({ id: d, label: d, role: role(d), tone: d.startsWith("CE") ? macTone(CES[d as VsCe].mac) : "#22d3ee", sub: d.startsWith("CE") ? CES[d as VsCe].ip.replace("192.168.", "…") : VS_LO[d as VsR], ...POS[d] }));
  const links: SpStageLink[] = [
    ...VS_CES.map((ce) => {
      const x = CES[ce];
      const k = acKey(x.ifn, x.vlan);
      const ac = s.cfg[x.pe].acs[k];
      const ok = !!ac && ac.vlan === x.vlan && !!s.cfg[x.pe].bd?.acs.includes(k);
      return { id: `${x.pe}-${ce}`, a: x.pe, b: ce, state: (ok ? "up" : "blocked") as SpStageLink["state"], label: ok ? "AC" : ac ? `AC VLAN ${ac.vlan ?? "?"}` : "not in VPLS" };
    }),
    ...VS_LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b, state: (v.ldp[l.id] ? "up" : "blocked") as SpStageLink["state"], label: v.ldp[l.id] ? "LDP" : "no LDP" })),
    ...[["PE1", "PE2"], ["PE1", "PE3"], ["PE2", "PE3"]].map(([a, b]) => {
      const ends = v.pws.filter((x) => (x.pe === a && x.peer === b) || (x.pe === b && x.peer === a));
      const up = ends.length === 2 && ends.every((x) => x.up);
      return { id: `pw-${a}-${b}`, a, b, state: (up ? "standby" : v.tldp[pairKey(a as VsR, b as VsR)] ? "blocked" : "down") as SpStageLink["state"], label: up ? "PW" : "PW down" };
    }),
  ];
  const views: Record<string, TopoView> = {};
  for (const pe of VS_PES) views[pe] = { badge: { text: `${(p.moment?.snap ?? c.live).fdb[pe].length} MAC`, tone: "info" } };
  const paths: SpPath[] = [];
  const last = s.tests[s.tests.length - 1];
  if (last && !p.moment && last.cfgSeq === s.cfgSeq && !last.flooded) paths.push({ id: "t", nodes: last.path.filter((x, i, a) => a.indexOf(x) === i), color: last.ok ? "#34d399" : "#f87171", offset: 0 });
  return <SpStage nodes={nodes} links={links} paths={paths} views={views} moment={p.moment} momentKey={p.momentKey} compact={p.compact} onNode={p.onNode} selected={p.selected} regions={[{ x: 15, y: 14, w: 70, h: 72, label: "provider core · IS-IS + LDP", color: "#22d3ee" }]} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------------------------
function Pws({ c, only }: { c: Ctx; only?: VsR }) {
  const rows = c.live.view.pws
    .filter((p) => !only || p.pe === only)
    .map((p) => [p.pe, `${p.peer ?? "?"} (${p.ip})`, p.pwid !== undefined ? String(p.pwid) : "—", p.local !== undefined ? String(p.local) : "—", p.remote ? String(p.remote.label) : "unknown", p.remote ? `${p.mtu} / ${p.remote.mtu}` : `${p.mtu} / ?`, p.up ? ["up", "ok"] : [pwWhyText(p, c.s.os), "bad"]] as (string | [string, "ok" | "bad"])[]);
  return <STable cols={["PE", "Neighbor", "PW ID", "Receives on", "Pushes", "MTU local / remote", "State"]} rows={rows} empty="No pseudowires." />;
}
function Macs({ c, only }: { c: Ctx; only?: VsR }) {
  const fdb = c.live.fdb;
  const owner = (mac: string) => VS_CES.find((x) => CES[x].mac === mac) ?? "?";
  const rows = VS_PES.filter((pe) => !only || pe === only).flatMap((pe) => fdb[pe].map((m) => [pe, m.mac, owner(m.mac), m.port.startsWith("pw:") ? `pseudowire to ${m.port.slice(3)}` : acName(c, m.port)] as string[]));
  return <STable cols={["PE", "MAC", "Belongs to", "Learned on"]} rows={rows} empty="Empty: nothing has been sent since the tables were cleared." />;
}
function Ldp({ c }: { c: Ctx }) {
  const v = c.live.view;
  const rows = [
    ...VS_LINKS.map((l) => [`${l.a} – ${l.b}`, "link", v.ldp[l.id] ? ["Operational", "ok"] : ["none", "bad"]] as (string | [string, "ok" | "bad"])[]),
    ...Object.entries(v.tldp).map(([k, up]) => [k.replace("-", " – "), "targeted", up ? ["Operational", "ok"] : ["none", "bad"]] as (string | [string, "ok" | "bad"])[]),
  ];
  return <STable cols={["Session", "Kind", "State"]} rows={rows} />;
}
function Lsp({ c }: { c: Ctx }) {
  const v = c.live.view;
  const rows = VS_ROUTERS.flatMap((r) =>
    VS_PES.filter((pe) => pe !== r).map((pe) => {
      const fec = VS_LO[pe];
      const t = v.lsp[r][fec];
      return [r, `${fec}/32`, String(ldpLabel(c.s.os, r, fec)), t?.out === undefined ? ["none (Unlabelled)", "bad"] : t.out === IMPLICIT_NULL ? "pop (PHP)" : String(t.out), t?.nh ?? "—"] as (string | [string, "bad"])[];
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
      {vsLadder(c.s).map((r, i) => (
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
      return card("The pseudowire mesh", <Pws c={c} />);
    case "macs":
      return card("MAC tables on the PEs", <Macs c={c} />);
    case "ldp":
      return card("LDP sessions (link and targeted)", <Ldp c={c} />);
    case "lsp":
      return card("Transport labels (LDP)", <Lsp c={c} />);
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
function cfgDiff(a: VsCfg, b: VsCfg): string {
  const out: string[] = [];
  for (const k of new Set([...Object.keys(a.acs), ...Object.keys(b.acs)])) {
    if (!a.acs[k]) out.push(`${k} created`);
    else if (!b.acs[k]) out.push(`${k} removed`);
    else if (JSON.stringify(a.acs[k]) !== JSON.stringify(b.acs[k])) out.push(`${k} changed`);
  }
  if (!a.bd && b.bd) out.push(`VPLS ${b.bd.name} created`);
  else if (a.bd && !b.bd) out.push(`VPLS ${a.bd.name} removed`);
  else if (a.bd && b.bd) {
    const na = a.bd.nbrs.map((n) => `${n.ip}/${n.pwid}`).join(",");
    const nb = b.bd.nbrs.map((n) => `${n.ip}/${n.pwid}`).join(",");
    if (na !== nb) out.push("VPLS neighbors changed");
    if (a.bd.mtu !== b.bd.mtu) out.push(`VPLS MTU ${b.bd.mtu}`);
    if (a.bd.vplsId !== b.bd.vplsId) out.push(`VPLS ID ${b.bd.vplsId ?? "removed"}`);
    if (a.bd.acs.join() !== b.bd.acs.join()) out.push("VPLS interfaces changed");
    if (a.bd.vfi !== b.bd.vfi) out.push(`VFI ${b.bd.vfi ? "created" : "removed"}`);
  }
  for (const k of Object.keys(b.ldp) as IfName[]) if (!!a.ldp[k] !== !!b.ldp[k]) out.push(`${k} LDP ${b.ldp[k] ? "on" : "off"}`);
  if (a.ldpLo !== b.ldpLo) out.push(`LDP on lo0.0 ${b.ldpLo ? "on" : "off"}`);
  return out.join(", ") || "no change";
}
function devCli(c: Ctx, r: VsR): SpDevCli<VsCfg> {
  return {
    host: r,
    running: c.s.cfg[r],
    hist: c.s.hist[r],
    cand: c.cli.cand[r] as VsCfg | undefined,
    setCand: (x) => c.cli.setCand(r, x),
    xr: c.cli.xr[r] ?? [],
    setXr: (st) => c.cli.setXr(r, st),
    edit: !!c.cli.edit[r],
    setEdit: (b) => c.cli.setEdit(r, b),
    commit: (cfg, how) => c.act({ type: "cfg", dev: r, cfg, text: `${cfgDiff(c.s.cfg[r], cfg)} (${how}, ${c.vendor === "cisco" ? "IOS XR" : "Junos"})` }),
    ask: c.cli.setQuestion,
  };
}
function RouterUI({ c, r }: { c: Ctx; r: VsR }) {
  const pe = VS_PES.includes(r);
  const [tab, setTab] = useState<"bridge" | "labels" | "term" | "log">(pe ? "bridge" : "labels");
  const s = c.s;
  const cfg = s.cfg[r];
  const change = (f: (x: VsCfg) => void) => {
    const n = spClone(cfg);
    f(n);
    c.act({ type: "cfg", dev: r, cfg: n, text: `${cfgDiff(cfg, n)} (from ${r}'s window)` });
  };
  const api: VsCliApi = { s, act: c.act, dev: devCli(c, r) };
  return (
    <div>
      <Tabs tabs={[...(pe ? ([["bridge", "Bridge"]] as ["bridge", string][]) : []), ["labels", "Labels & LDP"], ["term", "Console"], ["log", "Log"]]} cur={tab} set={setTab} />
      <div className="space-y-2 p-3">
        {tab === "bridge" && pe && (
          <>
            <Card title={cfg.bd ? `${c.vendor === "cisco" ? `bridge group ${cfg.bd.group} · bridge-domain` : "routing-instance"} ${cfg.bd.name}` : "No VPLS configured"}>
              {cfg.bd && (
                <div className="grid gap-x-4 sm:grid-cols-2">
                  <Kv k="Attachment circuits" v={cfg.bd.acs.map((k) => `${acName(c, k)} · VLAN ${cfg.acs[k]?.vlan ?? "none"}`).join(", ") || "none"} tone={cfg.bd.acs.length ? undefined : "warn"} />
                  <Kv k="Neighbors" v={cfg.bd.nbrs.map((n) => n.ip).join(", ") || "none"} tone={cfg.bd.nbrs.length === 2 ? undefined : "warn"} />
                  <Kv k={c.vendor === "cisco" ? "PW ID" : "VPLS ID"} v={c.vendor === "cisco" ? [...new Set(cfg.bd.nbrs.map((n) => n.pwid))].join(", ") || "—" : String(cfg.bd.vplsId ?? "none")} />
                  <Kv k="MTU" v={String(cfg.bd.mtu)} />
                </div>
              )}
            </Card>
            <Pws c={c} only={r} />
            <Macs c={c} only={r} />
            <div className="flex flex-wrap items-center gap-2">
              <Pill onClick={() => c.act({ type: "clear", dev: r })} disabled={c.busy}>
                Clear {r}&apos;s MAC table
              </Pill>
              <span className="text-[11.5px] text-pv-text-faint">The bridge itself is configured in the Console (candidate + commit).</span>
            </div>
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
        {tab === "term" && <SpConsole c={c.cli} sets={vsSets(api, r)} os={c.vendor === "cisco" ? "iosxr" : "junos"} host={r} vendor={c.vendor} setVendor={c.setVendor} pipeCtx={c.vendor === "juniper" ? vsPipe(api, r) : undefined} />}
        {tab === "log" && (
          <ul className="space-y-0.5">
            {s.sys.filter((x) => x.dev === r).slice(-30).reverse().map((x, i) => (
              <li key={i} className="pv-mono text-[11.5px] text-pv-text-muted">
                {spStamp(x.t).hms} {x.kind === "commit" ? "configuration committed" : x.kind === "clear" ? "MAC table cleared" : x.kind.startsWith("pw") ? `pseudowire to ${x.peer} ${x.kind === "pw-up" ? "up" : "down"}` : `LDP ${x.peer} ${x.kind === "ldp-up" ? "up" : "down"}`}
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
          <span className="text-[11.5px] text-pv-text-faint">for challenge 5</span>
        </div>
      )}
    </div>
  );
}

const SPEC: SpLabSpec<VsState, VsAction, VsSnap> = {
  title: "VPLS Lab",
  note: () => "three PEs · one customer LAN · full-mesh pseudowires",
  fresh: (seq, vendor) => createVsNet(seq, vendor === "cisco" ? "xr" : "junos"),
  vendorAction: (v) => ({ type: "os", os: v === "cisco" ? "xr" : "junos" }),
  apply: vsApply,
  snapOf: (s) => ({ view: s.view, fdb: s.fdb }),
  ticketAction: (id) => ({ type: "ticket", id: id as VsTicketId }),
  levels: VS_LEVELS,
  gate: {
    title: "You can follow Ethernet frames through a VPLS",
    points: [
      "Each PE bridges: its ports are the attachment circuits and one pseudowire to every other PE.",
      "It learns source MACs per port, sends known destinations to one port and floods broadcast and unknown unicast.",
      "A frame from a pseudowire never leaves on another pseudowire (split horizon) — so the mesh must be full.",
      "Every pseudowire needs the same PW ID / VPLS ID and MTU at both ends, and an LSP underneath.",
      "An empty MAC table costs flooding, not reachability; a missing pseudowire costs reachability.",
    ],
    more: "The engineering workspace gives you PE1–PE3 and P1–P3 in their own windows (the bridge with its MAC table, labels and LDP, an IOS XR / Junos console with commit), pings from four sites, five challenges and five tickets.",
  },
  stage,
  footer: (c) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
      <span>
        Pseudowires up: <b className="pv-mono text-pv-text">{c.s.view.pws.filter((p) => p.up).length}/{c.s.view.pws.length}</b> · MACs learned {VS_PES.reduce((n, pe) => n + c.live.fdb[pe].length, 0)}
      </span>
      <span className="text-pv-text-faint">CE colors match their MAC addresses in the tables</span>
    </div>
  ),
  devices: VS_ROUTERS,
  device: (id, c) => ({ label: id, icon: role(id), tone: "#22d3ee", sub: `${VS_LO[id as VsR]} · ${c.vendor === "cisco" ? "IOS XR" : "Junos"} view` }),
  openFrom: 1,
  window: (id, c) => <RouterUI c={c} r={id as VsR} />,
  tools: [
    { id: "pws", label: "Pseudowires", render: (c) => <Pws c={c} /> },
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
    "Clear all MAC tables, ping 192.168.100.3 from CE1, and read each PE's MAC table (show l2vpn forwarding bridge-domain mac-address location 0/0/CPU0 / show vpls mac-table). Why does PE2 know CE1 but not CE3?",
    "On PE1, show l2vpn bridge-domain detail (IOS XR) or show vpls connections (Junos): which label does PE1 receive from each neighbor, and which does it push?",
    "Remove one neighbor from one PE and find out exactly which pairs of sites lose each other — and why PE2 can't help.",
    "On P1, try show l2vpn bridge-domain. Why is there nothing to show?",
    "Ping the same host twice and compare the walks: what stopped flooding?",
  ],
  challenges: VS_CHALLENGES,
  tickets: VS_TICKETS.map((t) => ({ id: t.id, title: t.title, report: t.report, reproLabel: t.reproLabel, repro: t.repro })),
  ticketIntro: "Customers report symptoms, not causes. Each ticket is this network after a change with one real thing wrong. Reproduce it, walk the evidence (attachment circuits, the mesh, the pseudowires, the transport), name the cause, fix it on the router and prove it with a fresh ping.",
  reproHint: "Watch where each frame goes — and where it doesn't.",
  fixHint: "Fix it on the router (its console — commit to apply), check the pseudowires, then run the ping again. A frame that floods everywhere isn't proof that every site is reachable.",
  causes: VS_CAUSES,
  feedback: vsCauseFeedback,
  proofs: vsProofs,
  ladder: (s) => vsLadder(s),
  text: (v, t) => spText(v, t),
  runCard: (c) => (
    <Card title="Result">
      <TestView c={c} />
    </Card>
  ),
};

export function VplsLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SpLabWorkspace spec={SPEC} open={open} onClose={onClose} />;
}
