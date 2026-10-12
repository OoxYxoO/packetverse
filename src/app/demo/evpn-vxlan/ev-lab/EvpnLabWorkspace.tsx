"use client";

import { useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { SpLabWorkspace, type SpCtx, type SpLabSpec } from "@/components/sp-lab/SpLabWorkspace";
import { SpStage, type SpPath, type SpStageLink, type SpStageNode } from "@/components/sp-lab/SpStage";
import { SpConsole } from "@/components/sp-lab/SpDesk";
import { Card, Kv, Pill, STable, Tabs } from "@/components/sp-lab/SpUi";
import { spClone, spStamp, type SpMoment } from "@/components/sp-lab/spKit";
import type { SpDevCli } from "@/components/sp-lab/spCli";
import type { TopoView } from "@/components/presentation/Visuals";
import {
  EV_CAUSES,
  EV_HOSTS,
  EV_LEAVES,
  EV_LINKS,
  EV_LO,
  EV_ROUTERS,
  EV_TICKETS,
  HOSTS,
  OTHER,
  createEvNet,
  evApply,
  evCauseFeedback,
  evLadder,
  evProofs,
  isLeaf,
  localVnis,
  macTable,
  remoteVteps,
  type EvAction,
  type EvCfg,
  type EvHost,
  type EvIf,
  type EvLeaf,
  type EvR,
  type EvRoute,
  type EvSnap,
  type EvState,
  type EvTicketId,
} from "@/lib/sim-engine/scenarios/evNet";
import { evPipe, evSets, type EvCliApi } from "./evCli";
import { EV_LEVELS } from "./evLearn";
import { EV_CHALLENGES } from "./evPractice";

/**
 * EVPN-VXLAN Lab — two leaf VTEPs and a spine (Junos), on the shared SP lab workspace.
 *   LEARN                  6 levels (evLearn): one LAN across a routed fabric · VXLAN · EVPN routes · learning from BGP ·
 *                          build and break · evidence
 *   ENGINEERING WORKSPACE  Investigate (host pings; device windows with switching, EVPN routes, the underlay and a Junos
 *                          console) · Challenges (five) · Troubleshoot (five tickets)
 * One model (evNet.ts) produces every route, MAC entry, VXLAN packet and verdict.
 */

type Ctx = SpCtx<EvState, EvAction, EvSnap>;
type Node = EvR | EvHost;
const POS: Record<Node, { x: number; y: number; cx: number; cy: number }> = {
  "HOST-A": { x: 7, y: 20, cx: 8, cy: 16 },
  "HOST-C": { x: 7, y: 50, cx: 8, cy: 50 },
  "HOST-E": { x: 7, y: 80, cx: 8, cy: 84 },
  LEAF1: { x: 29, y: 50, cx: 30, cy: 50 },
  SPINE1: { x: 50, y: 22, cx: 50, cy: 16 },
  LEAF2: { x: 71, y: 50, cx: 70, cy: 50 },
  "HOST-B": { x: 93, y: 32, cx: 92, cy: 28 },
  "HOST-F": { x: 93, y: 72, cx: 92, cy: 76 },
};
const role = (d: string) => (d.startsWith("HOST") ? "host" : d === "SPINE1" ? "spine" : "VTEP");
const macTone = (m: string) => ({ aa: "#a78bfa", cc: "#f472b6", ee: "#60a5fa", bb: "#34d399", ff: "#fbbf24" })[m.slice(0, 2)] ?? "#94a3b8";
const hostOfMac = (m: string) => EV_HOSTS.find((h) => HOSTS[h].mac === m) ?? "?";
const routeName = (r: EvRoute) => (r.type === 3 ? `Type 3 · VNI ${r.vni} · VTEP ${r.nh}` : `Type 2 · VNI ${r.vni} · ${r.mac}${r.ip ? ` + ${r.ip}` : ""}`);

function stage(c: Ctx, p: { moment?: SpMoment<EvSnap>; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) {
  const s = c.s;
  const v = c.live.view;
  const nodes: SpStageNode[] = (Object.keys(POS) as Node[]).map((d) => ({ id: d, label: d, role: role(d), tone: d.startsWith("HOST") ? macTone(HOSTS[d as EvHost].mac) : "#22d3ee", sub: d.startsWith("HOST") ? HOSTS[d as EvHost].ip : EV_LO[d as EvR], ...POS[d] }));
  const links: SpStageLink[] = [
    ...EV_HOSTS.map((h) => {
      const d = HOSTS[h];
      const vl = s.cfg[d.leaf].ports[d.port]?.vlan;
      const vni = vl ? s.cfg[d.leaf].vlans[vl]?.vni : undefined;
      return { id: `${d.leaf}-${h}`, a: d.leaf, b: h, state: (vl ? "up" : "blocked") as SpStageLink["state"], label: vl ? `${vl}${vni ? ` → ${vni}` : ""}` : "no VLAN" };
    }),
    ...EV_LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b, state: (v.ospf[l.id] ? "up" : "blocked") as SpStageLink["state"], label: v.ospf[l.id] ? "OSPF" : "no OSPF" })),
    { id: "bgp", a: "LEAF1", b: "LEAF2", state: (v.bgp.evpn ? "standby" : v.bgp.up ? "blocked" : "down") as SpStageLink["state"], label: v.bgp.evpn ? "BGP EVPN" : v.bgp.up ? "BGP, no EVPN" : "BGP down" },
  ];
  const views: Record<string, TopoView> = {};
  for (const l of EV_LEAVES) views[l] = { badge: { text: `${macTable(s.cfg, (p.moment?.snap ?? c.live).view, (p.moment?.snap ?? c.live).fdb, l).length} MAC`, tone: "info" } };
  const paths: SpPath[] = [];
  const last = s.tests[s.tests.length - 1];
  if (last && !p.moment && last.cfgSeq === s.cfgSeq && !last.flooded) paths.push({ id: "t", nodes: last.path.filter((x, i, a) => a.indexOf(x) === i), color: last.ok ? "#34d399" : "#f87171", offset: 0 });
  return <SpStage nodes={nodes} links={links} paths={paths} views={views} moment={p.moment} momentKey={p.momentKey} compact={p.compact} onNode={p.onNode} selected={p.selected} regions={[{ x: 19, y: 8, w: 62, h: 58, label: "routed IP fabric (underlay)", color: "#22d3ee" }]} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------------------------
type Cell = string | [string, "ok" | "bad"];
function Fabric({ c }: { c: Ctx }) {
  const s = c.s;
  const v = c.live.view;
  const rows: Cell[][] = EV_LEAVES.map((l) => {
    const cf = s.cfg[l];
    const map = Object.entries(cf.vlans).map(([n, x]) => `${n} (VLAN ${x.id}) → ${x.vni ?? "—"}`).join(", ");
    const vnis = localVnis(cf);
    const rv = vnis.map((n) => `${n}: ${remoteVteps(v, l, n).join(", ") || "none"}`).join(" · ");
    return [l, cf.vtep ? EV_LO[l] : ["no VTEP", "bad"], map, vnis.join(", ") || ["none", "bad"], v.reach[l][EV_LO[OTHER[l]]] ? ["reachable", "ok"] : ["unreachable", "bad"], rv || "—"];
  });
  return (
    <div className="space-y-1">
      <STable cols={["Leaf", "VTEP", "VLAN → VNI", "Extended VNIs", `Other VTEP's loopback`, "Remote VTEPs per VNI (Type 3)"]} rows={rows} />
      <p className="text-[12px] text-pv-text-muted">
        BGP LEAF1 ↔ LEAF2: <b className={v.bgp.evpn ? "text-pv-success" : "text-pv-danger"}>{v.bgp.evpn ? "Established, family evpn" : v.bgp.up ? "Established, no family evpn" : "down"}</b>
      </p>
    </div>
  );
}
function Routes({ c, only }: { c: Ctx; only?: EvLeaf }) {
  const v = c.live.view;
  const rows: Cell[][] = (only ? [only] : EV_LEAVES).flatMap((l) => [
    ...v.adv.filter((r) => r.leaf === l).map((r) => [l, routeName(r), `RT ${r.rt}`, "advertised"] as Cell[]),
    ...v.received[l].map((r) => [l, routeName(r), `RT ${r.rt}`, v.usable[l].includes(r) ? ["received · imported · used", "ok"] : v.kept[l].includes(r) ? ["kept, VNI not local", "bad"] : ["received, RT not imported", "bad"]] as Cell[]),
  ]);
  return <STable cols={["Leaf", "EVPN route", "Route target", "Status"]} rows={rows} empty="No EVPN routes." />;
}
function Macs({ c, only }: { c: Ctx; only?: EvLeaf }) {
  const rows = (only ? [only] : EV_LEAVES).flatMap((l) => macTable(c.s.cfg, c.live.view, c.live.fdb, l).map((m) => [l, m.vlan, m.mac, hostOfMac(m.mac), m.ip ?? "—", m.remote ? `remote VTEP ${m.remote} (EVPN Type 2)` : `local ${m.where}`] as string[]));
  return <STable cols={["Leaf", "VLAN", "MAC", "Host", "IP", "Learned"]} rows={rows} empty="Empty: no host has sent anything since the tables were cleared." />;
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
          {m.lines[0]?.text}
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
        <span className="ml-2 text-[11.5px] font-normal text-pv-text-muted">{t.crossed ? "across the fabric" : "stayed on the leaf"} · {t.flooded ? "some frames flooded" : "every frame unicast"}</span>
      </p>
      {t.why && <p className="text-[11.5px] text-pv-warning">{t.why}</p>}
    </div>
  );
}
function Ladder({ c }: { c: Ctx }) {
  if (c.busy) return <p className="text-[12px] text-pv-text-faint">The ladder fills in when the run has finished.</p>;
  return (
    <ol className="space-y-1">
      {evLadder(c.s).map((r, i) => (
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
    case "fabric":
      return card("The fabric: VTEPs, VNIs, underlay, session", <Fabric c={c} />);
    case "routes":
      return card("EVPN routes", <Routes c={c} />);
    case "macs":
      return card("MAC tables on the leaves", <Macs c={c} />);
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
function cfgDiff(a: EvCfg, b: EvCfg): string {
  const out: string[] = [];
  for (const k of new Set([...Object.keys(a.ports), ...Object.keys(b.ports)]) as Set<EvIf>) if (JSON.stringify(a.ports[k]) !== JSON.stringify(b.ports[k])) out.push(`${k} → ${b.ports[k]?.vlan ?? "removed"}`);
  for (const k of new Set([...Object.keys(a.vlans), ...Object.keys(b.vlans)])) if (JSON.stringify(a.vlans[k]) !== JSON.stringify(b.vlans[k])) out.push(b.vlans[k] ? `vlan ${k} ${b.vlans[k].id}${b.vlans[k].vni ? ` → VNI ${b.vlans[k].vni}` : ""}` : `vlan ${k} removed`);
  if (JSON.stringify(a.evpn) !== JSON.stringify(b.evpn)) out.push("protocols evpn changed");
  if (JSON.stringify(a.bgp) !== JSON.stringify(b.bgp)) out.push("BGP changed");
  if (a.vtep !== b.vtep || a.rd !== b.rd) out.push("switch-options changed");
  if (JSON.stringify(a.ospf) !== JSON.stringify(b.ospf) || a.ospfLo !== b.ospfLo) out.push("OSPF changed");
  return out.join(", ") || "no change";
}
function devCli(c: Ctx, r: EvR): SpDevCli<EvCfg> {
  return {
    host: r,
    running: c.s.cfg[r],
    hist: c.s.hist[r],
    cand: c.cli.cand[r] as EvCfg | undefined,
    setCand: (x) => c.cli.setCand(r, x),
    xr: c.cli.xr[r] ?? [],
    setXr: (st) => c.cli.setXr(r, st),
    edit: !!c.cli.edit[r],
    setEdit: (b) => c.cli.setEdit(r, b),
    commit: (cfg, how) => c.act({ type: "cfg", dev: r, cfg, text: `${cfgDiff(c.s.cfg[r], cfg)} (${how}, Junos)` }),
    ask: c.cli.setQuestion,
  };
}
function RouterUI({ c, r }: { c: Ctx; r: EvR }) {
  const leaf = isLeaf(r);
  const [tab, setTab] = useState<"sw" | "evpn" | "under" | "term" | "log">(leaf ? "sw" : "under");
  const s = c.s;
  const cfg = s.cfg[r];
  const change = (f: (x: EvCfg) => void) => {
    const n = spClone(cfg);
    f(n);
    c.act({ type: "cfg", dev: r, cfg: n, text: `${cfgDiff(cfg, n)} (from ${r}'s window)` });
  };
  const api: EvCliApi = { s, act: c.act, dev: devCli(c, r) };
  const tabs: ["sw" | "evpn" | "under" | "term" | "log", string][] = [...(leaf ? ([["sw", "Switching"], ["evpn", "EVPN"]] as ["sw" | "evpn", string][]) : []), ["under", "Underlay"], ["term", "Console"], ["log", "Log"]];
  return (
    <div>
      <Tabs tabs={tabs} cur={tab} set={setTab} />
      <div className="space-y-2 p-3">
        {tab === "sw" && leaf && (
          <>
            <Card title={`${r} · VTEP ${cfg.vtep ? EV_LO[r] : "not configured"} · RD ${cfg.rd ?? "none"}`}>
              <div className="grid gap-x-4 sm:grid-cols-2">
                <Kv k="Access ports" v={Object.entries(cfg.ports).map(([p, x]) => `${p} → ${x?.vlan ?? "no VLAN"}`).join(", ") || "none"} />
                <Kv k="VLAN → VNI" v={Object.entries(cfg.vlans).map(([n, x]) => `${n} (${x.id}) → ${x.vni ?? "—"}`).join(", ") || "none"} />
                <Kv k="Extended VNIs" v={cfg.evpn?.extended.join(", ") || "none"} tone={cfg.evpn?.extended.length ? undefined : "warn"} />
                <Kv k="Route targets" v={Object.entries(cfg.evpn?.targets ?? {}).map(([n, rt]) => `${n}: ${rt}`).join(", ") || "none"} />
              </div>
            </Card>
            <Macs c={c} only={r as EvLeaf} />
            <div className="flex flex-wrap items-center gap-2">
              <Pill onClick={() => c.act({ type: "clear", dev: r as EvLeaf })} disabled={c.busy}>
                Clear {r}&apos;s MAC table
              </Pill>
              <span className="text-[11.5px] text-pv-text-faint">Configuration is done in the Console (candidate + commit).</span>
            </div>
          </>
        )}
        {tab === "evpn" && leaf && (
          <>
            <Card title="BGP EVPN">
              <Kv k="Neighbor" v={cfg.bgp?.nbr ?? "none"} tone={cfg.bgp?.nbr ? undefined : "warn"} />
              <Kv k="Session" v={c.live.view.bgp.evpn ? "Established, family evpn" : c.live.view.bgp.up ? "Established, no family evpn" : "down"} tone={c.live.view.bgp.evpn ? undefined : "warn"} />
            </Card>
            <Routes c={c} only={r as EvLeaf} />
          </>
        )}
        {tab === "under" && (
          <>
            <div className="max-w-full overflow-x-auto">
              <table className="w-full min-w-max text-left text-[12px]">
                <thead className="text-pv-text-faint">
                  <tr>
                    {["Interface", "To", "OSPF", "Adjacency"].map((h) => (
                      <th key={h} className="px-1">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {EV_LINKS.filter((l) => l.a === r || l.b === r).map((l) => {
                    const ifn = l.a === r ? l.ai : l.bi;
                    const peer = l.a === r ? l.b : l.a;
                    return (
                      <tr key={l.id} className="border-t border-pv-border/40">
                        <td className="px-1 py-0.5 pv-mono text-pv-text">{ifn}.0</td>
                        <td className="px-1 text-pv-text-muted">{peer}</td>
                        <td className="px-1">
                          <input type="checkbox" aria-label={`ospf ${ifn}`} checked={!!cfg.ospf[ifn]} disabled={c.busy} onChange={(e) => change((x) => void (x.ospf[ifn] = e.target.checked))} />
                        </td>
                        <td className={clsx("px-1", c.live.view.ospf[l.id] ? "text-pv-success" : "text-pv-danger")}>{c.live.view.ospf[l.id] ? "Full" : "none"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <STable cols={["Loopback", "Owner", "Reachable from here"]} rows={EV_ROUTERS.filter((x) => x !== r).map((x) => [EV_LO[x], x, c.live.view.reach[r][EV_LO[x]] ? ["yes (OSPF)", "ok"] : ["no route", "bad"]] as Cell[])} />
          </>
        )}
        {tab === "term" && <SpConsole c={c.cli} sets={evSets(api, r)} os="junos" host={r} vendor="juniper" pipeCtx={evPipe(api, r)} />}
        {tab === "log" && (
          <ul className="space-y-0.5">
            {s.sys.filter((x) => x.dev === r).slice(-30).reverse().map((x, i) => (
              <li key={i} className="pv-mono text-[11.5px] text-pv-text-muted">
                {spStamp(x.t).hms} {x.kind === "commit" ? "configuration committed" : x.kind === "clear" ? "MAC table cleared" : x.kind.startsWith("bgp") ? `BGP ${x.peer} ${x.kind === "bgp-up" ? "Established" : "down"}` : `OSPF ${x.peer} ${x.kind === "ospf-up" ? "Full" : "down"}`}
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
function Composer({ c }: { c: Ctx }) {
  const [from, setFrom] = useState<EvHost>("HOST-A");
  const [to, setTo] = useState("10.10.10.22");
  const sel = "rounded border border-pv-border bg-pv-bg px-1 py-0.5 text-[12px] text-pv-text";
  return (
    <div className="space-y-2 rounded-xl border border-pv-border p-2">
      <p className="text-[12px] font-semibold text-pv-text">Host traffic</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <select aria-label="From" className={sel} value={from} onChange={(e) => setFrom(e.target.value as EvHost)}>
          {EV_HOSTS.map((x) => (
            <option key={x} value={x}>
              {x} ({HOSTS[x].ip}, on {HOSTS[x].leaf})
            </option>
          ))}
        </select>
        <span className="text-pv-text-faint">→</span>
        <select aria-label="To" className={sel} value={to} onChange={(e) => setTo(e.target.value)}>
          {EV_HOSTS.map((h) => (
            <option key={h} value={HOSTS[h].ip}>
              {HOSTS[h].ip}
            </option>
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
          <Pill onClick={() => c.act({ type: "wipe-leaf2" })} disabled={c.busy || !!c.s.wiped} tone="danger">
            Wipe LEAF2&apos;s overlay
          </Pill>
          <span className="text-[11.5px] text-pv-text-faint">for challenge 5</span>
        </div>
      )}
    </div>
  );
}

const SPEC: SpLabSpec<EvState, EvAction, EvSnap> = {
  title: "EVPN-VXLAN Lab",
  note: () => "two leaf VTEPs · one spine · Junos",
  fresh: (seq) => createEvNet(seq),
  vendors: ["juniper"],
  apply: evApply,
  snapOf: (s) => ({ view: s.view, fdb: s.fdb }),
  ticketAction: (id) => ({ type: "ticket", id: id as EvTicketId }),
  levels: EV_LEVELS,
  gate: {
    title: "You can follow a frame across an EVPN-VXLAN fabric",
    points: [
      "Each leaf is a VTEP; its local VLAN maps to a fabric-wide VNI — the VLAN number stays local.",
      "VXLAN wraps the frame in UDP/IP between VTEP loopbacks; the spine routes on the outer header only.",
      "Type 3 routes tell each leaf which VTEPs share a VNI: the flood list for ingress replication.",
      "Type 2 routes carry MACs (and IPs): remote MACs are learned from BGP, not from the tunnel.",
      "Underlay reachability, family evpn, the VNI and the route target must all line up.",
    ],
    more: "The engineering workspace gives you both leaves and the spine in their own windows (switching, EVPN routes, the underlay and a Junos console with commit), pings from five hosts, five challenges and five tickets.",
  },
  stage,
  footer: (c) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
      <span>
        EVPN routes in use: <b className="pv-mono text-pv-text">{EV_LEAVES.reduce((n, l) => n + c.live.view.usable[l].length, 0)}</b> · session {c.live.view.bgp.evpn ? "up" : "not carrying EVPN"}
      </span>
      <span className="text-pv-text-faint">host colors match their MAC addresses in the tables</span>
    </div>
  ),
  devices: EV_ROUTERS,
  device: (id) => ({ label: id, icon: role(id), tone: "#22d3ee", sub: `${EV_LO[id as EvR]} · Junos` }),
  openFrom: 1,
  window: (id, c) => <RouterUI c={c} r={id as EvR} />,
  tools: [
    { id: "fabric", label: "Fabric", render: (c) => <Fabric c={c} /> },
    { id: "routes", label: "EVPN routes", render: (c) => <Routes c={c} /> },
    { id: "macs", label: "MAC tables", render: (c) => <Macs c={c} /> },
    { id: "path", label: "Last ping, frame by frame", render: (c) => <PathView c={c} /> },
    { id: "log", label: "Log", render: (c) => <LogTool c={c} /> },
  ],
  toolsLabel: { learn: "What the devices know", eng: "Tools" },
  evidence,
  composer: (c) => <Composer c={c} />,
  investigate: [
    "Before any ping, run show route table bgp.evpn.0 on LEAF1: which route types are there, and why no Type 2 yet?",
    "Ping 10.10.10.22 from HOST-A, then compare show evpn database and show ethernet-switching table on LEAF1. How is HOST-B listed in each?",
    "On SPINE1, try show ethernet-switching table. Why is it empty?",
    "Give LEAF2's V10 VLAN ID 110 and ping again. What does that tell you about VLANs and VNIs?",
    "Clear the tables, ping only HOST-A → HOST-C, and look for HOST-C on LEAF2. How did it get there?",
  ],
  challenges: EV_CHALLENGES,
  tickets: EV_TICKETS.map((t) => ({ id: t.id, title: t.title, report: t.report, reproLabel: t.reproLabel, repro: t.repro })),
  ticketIntro: "Users report symptoms, not causes. Each ticket is this fabric after a change with one real thing wrong. Reproduce it, walk the evidence (access ports, underlay, the session and its family, the VNI mapping, route import), name the cause, fix it on the leaf and prove it with a fresh ping.",
  reproHint: "Watch where the flood goes — and where it stops.",
  fixHint: "Fix it on the device (its console — commit to apply), check the EVPN routes, then run the ping again. An Established session is not proof that the routes are used.",
  causes: EV_CAUSES,
  feedback: evCauseFeedback,
  proofs: evProofs,
  ladder: (s) => evLadder(s),
  runCard: (c) => (
    <Card title="Result">
      <TestView c={c} />
    </Card>
  ),
};

export function EvpnLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SpLabWorkspace spec={SPEC} open={open} onClose={onClose} />;
}
