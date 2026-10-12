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
  HUB,
  HV_CAUSES,
  HV_CES,
  HV_LINKS,
  HV_LO,
  HV_PES,
  HV_ROUTERS,
  HV_TICKETS,
  HV_VPLS,
  IMPLICIT_NULL,
  acKey,
  createHvNet,
  hvApply,
  hvCauseFeedback,
  hvLadder,
  hvProofs,
  isMtu,
  isVpls,
  ldpLabel,
  pairKey,
  pwWhyText,
  type HvAction,
  type HvCe,
  type HvCfg,
  type HvPw,
  type HvR,
  type HvSnap,
  type HvState,
  type HvTicketId,
  type IfName,
} from "@/lib/sim-engine/scenarios/hvNet";
import { hvPipe, hvSets, xrSub, type HvCliApi } from "./hvCli";
import { HV_LEVELS } from "./hvLearn";
import { HV_CHALLENGES } from "./hvPractice";

/**
 * H-VPLS Lab — three MTU-s access bridges with one spoke each, three PE-rs hubs in a full mesh, on the shared SP lab
 * workspace.
 *   LEARN                  6 levels (hvLearn): two tiers · the access bridge · spoke, mesh, spoke · split horizon by role ·
 *                          labels and transport · evidence
 *   ENGINEERING WORKSPACE  Investigate (customer pings; device windows with the bridge, MAC table, labels and an
 *                          IOS XR / Junos console) · Challenges (five) · Troubleshoot (five tickets)
 * One model (hvNet.ts) produces every pseudowire, port role, MAC table entry, label and verdict.
 */

type Ctx = SpCtx<HvState, HvAction, HvSnap>;
type Node = HvR | HvCe;
const POS: Record<Node, { x: number; y: number; cx: number; cy: number }> = {
  CE1: { x: 5, y: 12, cx: 6, cy: 8 },
  CE2: { x: 5, y: 38, cx: 6, cy: 34 },
  MTU1: { x: 19, y: 25, cx: 21, cy: 21 },
  PE1: { x: 36, y: 25, cx: 39, cy: 21 },
  P1: { x: 52, y: 50, cx: 54, cy: 50 },
  PE2: { x: 36, y: 77, cx: 39, cy: 79 },
  MTU2: { x: 19, y: 77, cx: 21, cy: 79 },
  CE3: { x: 5, y: 64, cx: 6, cy: 66 },
  CE5: { x: 5, y: 90, cx: 6, cy: 92 },
  PE3: { x: 68, y: 50, cx: 71, cy: 50 },
  MTU3: { x: 83, y: 50, cx: 85, cy: 34 },
  CE4: { x: 96, y: 50, cx: 95, cy: 66 },
};
const role = (d: string) => (d.startsWith("CE") ? "CE" : d.startsWith("PE") ? "PE-rs" : d.startsWith("MTU") ? "MTU-s" : "P");
const acName = (c: Ctx, k: string) => (c.vendor === "cisco" ? xrSub(k, true) : k);
const macTone = (m: string) => ({ "00:11": "#a78bfa", "00:22": "#fbbf24", "00:33": "#34d399", "00:44": "#f472b6", "00:55": "#60a5fa" })[m.slice(0, 5)] ?? "#94a3b8";
/** How this device classifies the pseudowire (an MTU-s has exactly one, its spoke). */
export function roleName(p: HvPw): string {
  if (isMtu(p.dev)) return "spoke (uplink)";
  if (p.role === "mesh") return p.peer && isMtu(p.peer) ? "mesh — but toward an MTU-s" : "mesh (core)";
  return p.peer && !isMtu(p.peer) ? "spoke — but toward a PE-rs" : "spoke";
}

function stage(c: Ctx, p: { moment?: SpMoment<HvSnap>; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) {
  const s = c.s;
  const v = c.live.view;
  const nodes: SpStageNode[] = (Object.keys(POS) as Node[]).map((d) => ({ id: d, label: d, role: role(d), tone: d.startsWith("CE") ? macTone(CES[d as HvCe].mac) : d.startsWith("MTU") ? "#a78bfa" : "#22d3ee", sub: d.startsWith("CE") ? CES[d as HvCe].ip.replace("192.168.", "…") : HV_LO[d as HvR], ...POS[d] }));
  const pairUp = (a: HvR, b: HvR) => {
    const ends = v.pws.filter((x) => (x.dev === a && x.peer === b) || (x.dev === b && x.peer === a));
    return { up: ends.length === 2 && ends.every((x) => x.up), any: ends.length > 0 };
  };
  const links: SpStageLink[] = [
    ...HV_CES.map((ce) => {
      const x = CES[ce];
      const k = acKey(x.ifn, x.vlan);
      const ac = s.cfg[x.dev].acs[k];
      const ok = !!ac && ac.vlan === x.vlan && !!s.cfg[x.dev].bd?.acs.includes(k);
      return { id: `${x.dev}-${ce}`, a: x.dev, b: ce, state: (ok ? "up" : "blocked") as SpStageLink["state"], label: ok ? "AC" : ac ? `AC VLAN ${ac.vlan ?? "?"}` : "not in service" };
    }),
    ...HV_LINKS.filter((l) => l.b === "P1").map((l) => ({ id: l.id, a: l.a, b: l.b, state: (v.ldp[l.id] ? "up" : "blocked") as SpStageLink["state"], label: v.ldp[l.id] ? "LDP" : "no LDP" })),
    ...(["MTU1", "MTU2", "MTU3"] as HvR[]).map((m) => {
      const l = HV_LINKS.find((x) => x.a === m)!;
      const pw = pairUp(m, HUB[m]);
      const wrong = v.pws.some((x) => x.dev === HUB[m] && x.peer === m && x.role === "mesh");
      return { id: l.id, a: m, b: HUB[m], state: (!v.ldp[l.id] ? "blocked" : pw.up ? (wrong ? "blocked" : "standby") : "down") as SpStageLink["state"], label: !v.ldp[l.id] ? "no LDP" : pw.up ? (wrong ? "spoke as mesh!" : "spoke PW") : "spoke down" };
    }),
    ...[["PE1", "PE2"], ["PE1", "PE3"], ["PE2", "PE3"]].map(([a, b]) => {
      const pw = pairUp(a as HvR, b as HvR);
      return { id: `pw-${a}-${b}`, a, b, state: (pw.up ? "standby" : v.tldp[pairKey(a as HvR, b as HvR)] ? "blocked" : "down") as SpStageLink["state"], label: pw.up ? "mesh PW" : "mesh down" };
    }),
  ];
  const views: Record<string, TopoView> = {};
  for (const r of HV_VPLS) views[r] = { badge: { text: `${(p.moment?.snap ?? c.live).fdb[r].length} MAC`, tone: "info" } };
  const paths: SpPath[] = [];
  const last = s.tests[s.tests.length - 1];
  if (last && !p.moment && last.cfgSeq === s.cfgSeq && !last.flooded) paths.push({ id: "t", nodes: last.path.filter((x, i, a) => a.indexOf(x) === i), color: last.ok ? "#34d399" : "#f87171", offset: 0 });
  return <SpStage nodes={nodes} links={links} paths={paths} views={views} moment={p.moment} momentKey={p.momentKey} compact={p.compact} onNode={p.onNode} selected={p.selected} regions={[{ x: 28, y: 8, w: 48, h: 84, label: "PE-rs core mesh", color: "#22d3ee" }]} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------------------------
type Cell = string | [string, "ok" | "bad"];
function Pws({ c, only }: { c: Ctx; only?: HvR }) {
  const rows = c.live.view.pws
    .filter((p) => !only || p.dev === only)
    .map((p) => [p.dev, `${p.peer ?? "?"} (${p.ip})`, /—/.test(roleName(p)) ? [roleName(p), "bad"] : roleName(p), p.pwid !== undefined ? String(p.pwid) : "—", p.local !== undefined ? String(p.local) : "—", p.remote ? String(p.remote.label) : "unknown", p.remote ? `${p.mtu} / ${p.remote.mtu}` : `${p.mtu} / ?`, p.up ? ["up", "ok"] : [pwWhyText(p, c.s.os), "bad"]] as Cell[]);
  return <STable cols={["Device", "Neighbor", "Role", "PW ID", "Receives on", "Pushes", "MTU local / remote", "State"]} rows={rows} empty="No pseudowires." />;
}
function Macs({ c, only }: { c: Ctx; only?: HvR }) {
  const fdb = c.live.fdb;
  const owner = (mac: string) => HV_CES.find((x) => CES[x].mac === mac) ?? "?";
  const pwOf = (r: HvR, ip: string) => c.live.view.pws.find((p) => p.dev === r && p.ip === ip);
  const rows = HV_VPLS.filter((r) => !only || r === only).flatMap((r) =>
    fdb[r].map((m) => {
      const pw = m.port.startsWith("pw:") ? pwOf(r, m.port.slice(3)) : undefined;
      return [r, m.mac, owner(m.mac), m.port.startsWith("pw:") ? `${pw ? roleName(pw).split(" ")[0] : ""} PW to ${pw?.peer ?? m.port.slice(3)}` : acName(c, m.port)] as string[];
    }),
  );
  return <STable cols={["Device", "MAC", "Belongs to", "Learned on"]} rows={rows} empty="Empty: nothing has been sent since the tables were cleared." />;
}
function Count({ c }: { c: Ctx }) {
  const up = c.live.view.pws.filter((p) => p.up);
  const spokes = up.filter((p) => isMtu(p.dev)).length;
  const mesh = up.filter((p) => !isMtu(p.dev) && p.peer && !isMtu(p.peer)).length / 2;
  const rows: Cell[][] = [
    ["Flat VPLS: all 6 devices full-meshed", "6 × 5 / 2", "15"],
    ["H-VPLS: 3 PE-rs mesh + 3 spokes", "3 + 3", "6"],
    ["Up in this network right now", `${mesh} mesh + ${spokes} spoke${spokes === 1 ? "" : "s"}`, String(mesh + spokes)],
    ["Add a 100th MTU-s", "flat: +99 · H-VPLS: +1", "—"],
  ];
  return <STable cols={["Design", "Pseudowires", "Count"]} rows={rows} />;
}
function Ldp({ c }: { c: Ctx }) {
  const v = c.live.view;
  const rows = [
    ...HV_LINKS.map((l) => [`${l.a} – ${l.b}`, "link", v.ldp[l.id] ? ["Operational", "ok"] : ["none", "bad"]] as Cell[]),
    ...Object.entries(v.tldp).map(([k, up]) => [k.replace("~", " – "), "targeted", up ? ["Operational", "ok"] : ["none", "bad"]] as Cell[]),
  ];
  return <STable cols={["Session", "Kind", "State"]} rows={rows} />;
}
function Lsp({ c, only }: { c: Ctx; only?: HvR }) {
  const v = c.live.view;
  const rows = HV_ROUTERS.filter((r) => !only || r === only).flatMap((r) =>
    HV_VPLS.filter((x) => x !== r).map((x) => {
      const fec = HV_LO[x];
      const t = v.lsp[r][fec];
      return [r, `${fec}/32 (${x})`, String(ldpLabel(c.s.os, r, fec)), t?.out === undefined ? ["none (Unlabelled)", "bad"] : t.out === IMPLICIT_NULL ? "pop (PHP)" : String(t.out), t?.nh ?? "—"] as Cell[];
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
      <p className="text-[11px] text-pv-text-faint">MAC tables that learned something: {t.touched.join(", ") || "none"}</p>
    </div>
  );
}
function Ladder({ c }: { c: Ctx }) {
  if (c.busy) return <p className="text-[12px] text-pv-text-faint">The ladder fills in when the run has finished.</p>;
  return (
    <ol className="space-y-1">
      {hvLadder(c.s).map((r, i) => (
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
      return card("Spokes and the core mesh", <Pws c={c} />);
    case "macs":
      return card("MAC tables, both tiers", <Macs c={c} />);
    case "count":
      return card("How many pseudowires", <Count c={c} />);
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
function cfgDiff(a: HvCfg, b: HvCfg): string {
  const out: string[] = [];
  for (const k of new Set([...Object.keys(a.acs), ...Object.keys(b.acs)])) {
    if (!a.acs[k]) out.push(`${k} created`);
    else if (!b.acs[k]) out.push(`${k} removed`);
    else if (JSON.stringify(a.acs[k]) !== JSON.stringify(b.acs[k])) out.push(`${k} changed`);
  }
  if (!a.bd && b.bd) out.push(`service ${b.bd.name} created`);
  else if (a.bd && !b.bd) out.push(`service ${a.bd.name} removed`);
  else if (a.bd && b.bd) {
    const list = (x: { ip: string; pwid?: number }[]) => x.map((n) => `${n.ip}/${n.pwid ?? ""}`).join(",");
    if (list(a.bd.mesh) !== list(b.bd.mesh)) out.push("core mesh neighbors changed");
    if (list(a.bd.spokes) !== list(b.bd.spokes)) out.push("spokes changed");
    if (a.bd.mtu !== b.bd.mtu) out.push(`MTU ${b.bd.mtu}`);
    if (a.bd.vplsId !== b.bd.vplsId) out.push(`VPLS ID ${b.bd.vplsId ?? "removed"}`);
    if (JSON.stringify(a.bd.spokeGroup) !== JSON.stringify(b.bd.spokeGroup)) out.push("spoke mesh group changed");
    if (a.bd.acs.join() !== b.bd.acs.join()) out.push("interfaces changed");
    if (a.bd.vfi !== b.bd.vfi) out.push(`VFI ${b.bd.vfi ? "created" : "removed"}`);
  }
  for (const k of new Set([...Object.keys(a.ldp), ...Object.keys(b.ldp)]) as Set<IfName>) if (!!a.ldp[k] !== !!b.ldp[k]) out.push(`${k} LDP ${b.ldp[k] ? "on" : "off"}`);
  if (a.ldpLo !== b.ldpLo) out.push(`LDP on lo0.0 ${b.ldpLo ? "on" : "off"}`);
  return out.join(", ") || "no change";
}
function devCli(c: Ctx, r: HvR): SpDevCli<HvCfg> {
  return {
    host: r,
    running: c.s.cfg[r],
    hist: c.s.hist[r],
    cand: c.cli.cand[r] as HvCfg | undefined,
    setCand: (x) => c.cli.setCand(r, x),
    xr: c.cli.xr[r] ?? [],
    setXr: (st) => c.cli.setXr(r, st),
    edit: !!c.cli.edit[r],
    setEdit: (b) => c.cli.setEdit(r, b),
    commit: (cfg, how) => c.act({ type: "cfg", dev: r, cfg, text: `${cfgDiff(c.s.cfg[r], cfg)} (${how}, ${c.vendor === "cisco" ? "IOS XR" : "Junos"})` }),
    ask: c.cli.setQuestion,
  };
}
function RouterUI({ c, r }: { c: Ctx; r: HvR }) {
  const vp = isVpls(r);
  const [tab, setTab] = useState<"bridge" | "labels" | "term" | "log">(vp ? "bridge" : "labels");
  const s = c.s;
  const cfg = s.cfg[r];
  const change = (f: (x: HvCfg) => void) => {
    const n = spClone(cfg);
    f(n);
    c.act({ type: "cfg", dev: r, cfg: n, text: `${cfgDiff(cfg, n)} (from ${r}'s window)` });
  };
  const api: HvCliApi = { s, act: c.act, dev: devCli(c, r) };
  const xr = c.vendor === "cisco";
  return (
    <div>
      <Tabs tabs={[...(vp ? ([["bridge", "Bridge"]] as ["bridge", string][]) : []), ["labels", "Labels & LDP"], ["term", "Console"], ["log", "Log"]]} cur={tab} set={setTab} />
      <div className="space-y-2 p-3">
        {tab === "bridge" && vp && (
          <>
            <Card title={cfg.bd ? `${xr ? `bridge group ${cfg.bd.group} · bridge-domain` : "routing-instance"} ${cfg.bd.name} · ${isMtu(r) ? "MTU-s" : "PE-rs"}` : "No service configured"}>
              {cfg.bd && (
                <div className="grid gap-x-4 sm:grid-cols-2">
                  <Kv k="Attachment circuits" v={cfg.bd.acs.map((k) => `${acName(c, k)} · VLAN ${cfg.acs[k]?.vlan ?? "none"}`).join(", ") || "none"} />
                  <Kv k={xr ? "Access PWs (spokes)" : isMtu(r) ? "Neighbor (its hub)" : `Mesh group ${cfg.bd.spokeGroup?.name ?? "—"} (spokes)`} v={(xr || !isMtu(r) ? cfg.bd.spokes : cfg.bd.mesh).map((n) => n.ip).join(", ") || "none"} />
                  {!isMtu(r) && <Kv k={xr ? "VFI (core mesh)" : "Default mesh group (core)"} v={cfg.bd.mesh.map((n) => n.ip).join(", ") || "none"} tone={cfg.bd.mesh.length === 2 ? undefined : "warn"} />}
                  <Kv k={xr ? "PW IDs" : "VPLS ID"} v={xr ? [...new Set([...cfg.bd.mesh, ...cfg.bd.spokes].map((n) => n.pwid))].join(", ") || "—" : `${cfg.bd.vplsId ?? "none"}${cfg.bd.spokeGroup ? ` · ${cfg.bd.spokeGroup.name} ${cfg.bd.spokeGroup.vplsId ?? "none"}${cfg.bd.spokeGroup.local ? ", local-switching" : ""}` : ""}`} />
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
                    {["Interface", "To", "LDP", "Session"].map((h) => (
                      <th key={h} className="px-1">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {HV_LINKS.filter((l) => l.a === r || l.b === r).map((l) => {
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
            <Lsp c={c} only={r} />
          </>
        )}
        {tab === "term" && <SpConsole c={c.cli} sets={hvSets(api, r)} os={xr ? "iosxr" : "junos"} host={r} vendor={c.vendor} setVendor={c.setVendor} pipeCtx={!xr ? hvPipe(api, r) : undefined} />}
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
const HOSTS = ["192.168.100.1", "192.168.100.2", "192.168.100.3", "192.168.100.4", "192.168.100.5"];
function Composer({ c }: { c: Ctx }) {
  const [from, setFrom] = useState<HvCe>("CE1");
  const [to, setTo] = useState("192.168.100.3");
  const sel = "rounded border border-pv-border bg-pv-bg px-1 py-0.5 text-[12px] text-pv-text";
  return (
    <div className="space-y-2 rounded-xl border border-pv-border p-2">
      <p className="text-[12px] font-semibold text-pv-text">Customer traffic</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <select aria-label="From" className={sel} value={from} onChange={(e) => setFrom(e.target.value as HvCe)}>
          {HV_CES.map((x) => (
            <option key={x} value={x}>
              {x} ({CES[x].ip}, at {CES[x].dev})
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
          <Pill onClick={() => c.act({ type: "wipe-mtu3" })} disabled={c.busy || !!c.s.wiped} tone="danger">
            Wipe MTU3&apos;s service
          </Pill>
          <span className="text-[11.5px] text-pv-text-faint">for challenge 5</span>
        </div>
      )}
    </div>
  );
}

const SPEC: SpLabSpec<HvState, HvAction, HvSnap> = {
  title: "H-VPLS Lab",
  note: () => "three MTU-s · three PE-rs · spokes and a core mesh",
  fresh: (seq, vendor) => createHvNet(seq, vendor === "cisco" ? "xr" : "junos"),
  vendorAction: (v) => ({ type: "os", os: v === "cisco" ? "xr" : "junos" }),
  apply: hvApply,
  snapOf: (s) => ({ view: s.view, fdb: s.fdb }),
  ticketAction: (id) => ({ type: "ticket", id: id as HvTicketId }),
  levels: HV_LEVELS,
  gate: {
    title: "You can follow frames through a VPLS hierarchy",
    points: [
      "An MTU-s is a bridge with its attachment circuits and one spoke pseudowire to its PE-rs hub.",
      "Only the PE-rs form the full mesh: N(N−1)/2 among the hubs, plus one spoke per access device.",
      "The core mesh is one split-horizon group: mesh to mesh is forbidden, spoke to mesh and mesh to spoke are not.",
      "IOS XR: spokes are access pseudowires, the mesh lives in the VFI. Junos: the core in the default mesh group, spokes in a mesh group of their own.",
      "Sites behind the same MTU-s switch locally; everything else crosses spoke, mesh, spoke — with an LSP underneath.",
    ],
    more: "The engineering workspace gives you all seven devices in their own windows (the bridge with its MAC table, labels and LDP, an IOS XR / Junos console with commit), pings from five sites, five challenges and five tickets.",
  },
  stage,
  footer: (c) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
      <span>
        Pseudowire ends up: <b className="pv-mono text-pv-text">{c.s.view.pws.filter((p) => p.up).length}/{c.s.view.pws.length}</b> · MACs learned {HV_VPLS.reduce((n, r) => n + c.live.fdb[r].length, 0)}
      </span>
      <span className="text-pv-text-faint">CE colors match their MAC addresses in the tables</span>
    </div>
  ),
  devices: [...HV_PES, "MTU1", "MTU2", "MTU3", "P1"],
  device: (id, c) => ({ label: id, icon: role(id), tone: id.startsWith("MTU") ? "#a78bfa" : "#22d3ee", sub: `${HV_LO[id as HvR]} · ${c.vendor === "cisco" ? "IOS XR" : "Junos"} view` }),
  openFrom: 1,
  window: (id, c) => <RouterUI c={c} r={id as HvR} />,
  tools: [
    { id: "pws", label: "Pseudowires", render: (c) => <Pws c={c} /> },
    { id: "macs", label: "MAC tables", render: (c) => <Macs c={c} /> },
    { id: "count", label: "Pseudowire count", render: (c) => <Count c={c} /> },
    { id: "ldp", label: "LDP sessions", render: (c) => <Ldp c={c} /> },
    { id: "lsp", label: "Transport labels", render: (c) => <Lsp c={c} /> },
    { id: "path", label: "Last ping, frame by frame", render: (c) => <PathView c={c} /> },
    { id: "log", label: "Log", render: (c) => <LogTool c={c} /> },
  ],
  toolsLabel: { learn: "What the devices know", eng: "Tools" },
  evidence,
  composer: (c) => <Composer c={c} />,
  investigate: [
    "On PE1, show l2vpn bridge-domain (IOS XR) or show vpls connections (Junos): which pseudowire is a spoke and which are core mesh members, and where does each vendor show it?",
    "Clear all MAC tables, ping 192.168.100.2 from CE1, and read PE1's MAC table. Why does it hold CE1 but not CE2?",
    "Remove one core mesh neighbor on one PE-rs and find exactly which pairs of sites lose each other.",
    "Ping CE3 from CE1 twice and compare the label stacks on the spoke and on the mesh. Why does the spoke carry one label?",
    "On P1, try show l2vpn bridge-domain. Why is there nothing to show?",
  ],
  challenges: HV_CHALLENGES,
  tickets: HV_TICKETS.map((t) => ({ id: t.id, title: t.title, report: t.report, reproLabel: t.reproLabel, repro: t.repro })),
  ticketIntro: "Customers report symptoms, not causes. Each ticket is this network after a change with one real thing wrong. Reproduce it, walk the evidence (attachment circuits, spokes, the core mesh, port roles, transport), name the cause, fix it on the device and prove it with a fresh ping.",
  reproHint: "Watch where each frame goes — and where a device refuses to send it.",
  fixHint: "Fix it on the device (its console — commit to apply), check the pseudowires and their roles, then run the ping again. Every pseudowire being up is not proof that frames may cross them.",
  causes: HV_CAUSES,
  feedback: hvCauseFeedback,
  proofs: hvProofs,
  ladder: (s) => hvLadder(s),
  text: (v, t) => spText(v, t),
  runCard: (c) => (
    <Card title="Result">
      <TestView c={c} />
    </Card>
  ),
};

export function HvplsLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SpLabWorkspace spec={SPEC} open={open} onClose={onClose} />;
}
