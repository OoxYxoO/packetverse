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
  VP_CAUSES,
  VP_CES,
  VP_LINKS,
  VP_LO,
  VP_PES,
  VP_ROUTERS,
  VP_TICKETS,
  acKey,
  createVpNet,
  ldpLabel,
  pwWhyText,
  vpApply,
  vpCauseFeedback,
  vpForward,
  vpLadder,
  vpProofs,
  type IfName,
  type VpAction,
  type VpCe,
  type VpCfg,
  type VpR,
  type VpSnap,
  type VpState,
  type VpTicketId,
} from "@/lib/sim-engine/scenarios/vpNet";
import { vpPipe, vpSets, xrSub, type VpCliApi } from "./vpCli";
import { VP_LEVELS } from "./vpLearn";
import { VP_CHALLENGES } from "./vpPractice";

/**
 * MPLS L2VPN (VPWS) Lab — two point-to-point Ethernet services over one provider core, on the shared SP lab workspace.
 *   LEARN                  6 levels (vpLearn): the wire · attachment circuits · targeted LDP and the PW FEC · two labels ·
 *                          the transport underneath · evidence
 *   ENGINEERING WORKSPACE  Investigate (customer pings; router windows with services, labels and an IOS XR / Junos
 *                          console) · Challenges (five) · Troubleshoot (five tickets)
 * One model (vpNet.ts) produces every attachment circuit, pseudowire, label and verdict.
 */

type Ctx = SpCtx<VpState, VpAction, VpSnap>;
type Node = VpR | VpCe;
const POS: Record<Node, { x: number; y: number; cx: number; cy: number }> = {
  CE1A: { x: 6, y: 24, cx: 8, cy: 14 },
  CE1B: { x: 6, y: 76, cx: 8, cy: 86 },
  PE1: { x: 22, y: 50, cx: 20, cy: 50 },
  P1: { x: 40, y: 50, cx: 38, cy: 50 },
  P2: { x: 58, y: 50, cx: 58, cy: 50 },
  PE2: { x: 76, y: 50, cx: 78, cy: 50 },
  CE2A: { x: 94, y: 24, cx: 92, cy: 14 },
  CE2B: { x: 94, y: 76, cx: 92, cy: 86 },
};
const CUST_TONE: Record<string, string> = { "CUST-A": "#a78bfa", "CUST-B": "#fbbf24" };
const role = (d: string) => (d.startsWith("CE") ? "CE" : d.startsWith("PE") ? "PE" : "P");
const acName = (c: Ctx, k: string) => (c.vendor === "cisco" ? xrSub(k, true) : k);

function stage(c: Ctx, p: { moment?: SpMoment<VpSnap>; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) {
  const s = c.s;
  const v = c.live.view;
  const nodes: SpStageNode[] = (Object.keys(POS) as Node[]).map((d) => ({ id: d, label: d, role: role(d), tone: d.startsWith("CE") ? CUST_TONE[CES[d as VpCe].cust] : "#22d3ee", sub: d.startsWith("CE") ? `VLAN ${CES[d as VpCe].vlan}` : VP_LO[d as VpR], ...POS[d] }));
  const links: SpStageLink[] = [
    ...VP_CES.map((ce) => {
      const x = CES[ce];
      const k = acKey(x.ifn, x.vlan);
      const ac = s.cfg[x.pe].acs[k];
      const ok = !!ac && ac.vlan === x.vlan && s.cfg[x.pe].xcs.some((y) => y.ac === k);
      const other = Object.entries(s.cfg[x.pe].acs).find(([kk, a]) => kk.startsWith(`${x.ifn}.`) && a.vlan !== x.vlan);
      return { id: `${x.pe}-${ce}`, a: x.pe, b: ce, state: (ok ? "up" : "blocked") as SpStageLink["state"], label: ok ? `AC · VLAN ${x.vlan}` : other ? `AC expects VLAN ${other[1].vlan ?? "?"}` : "no AC" };
    }),
    ...VP_LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b, state: (v.ldp[l.id] ? "up" : "blocked") as SpStageLink["state"], label: v.ldp[l.id] ? "LDP" : "no LDP" })),
    (() => {
      const up = v.pws.filter((x) => x.pe === "PE1" && x.up).length;
      const all = v.pws.filter((x) => x.pe === "PE1").length;
      return { id: "PE1-PE2", a: "PE1", b: "PE2", state: (v.tldp.up ? (up === all && all ? "standby" : "blocked") : "down") as SpStageLink["state"], label: v.tldp.up ? `targeted LDP · PWs up ${up}/${all}` : "no targeted LDP" };
    })(),
  ];
  const views: Record<string, TopoView> = {};
  for (const pe of VP_PES) views[pe] = { badge: { text: `${s.cfg[pe].xcs.length} PW`, tone: "info" } };
  const paths: SpPath[] = [];
  const last = s.tests[s.tests.length - 1];
  if (last && !p.moment && last.cfgSeq === s.cfgSeq) paths.push({ id: "t", nodes: last.path, color: last.ok ? "#34d399" : "#f87171", offset: 0 });
  return <SpStage nodes={nodes} links={links} paths={paths} views={views} moment={p.moment} momentKey={p.momentKey} compact={p.compact} onNode={p.onNode} selected={p.selected} regions={[{ x: 15, y: 30, w: 68, h: 40, label: "provider core · IS-IS + LDP", color: "#22d3ee" }]} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------------------------
function Pws({ c, only }: { c: Ctx; only?: VpR }) {
  const rows = c.live.view.pws
    .filter((p) => !only || p.pe === only)
    .map((p) => {
      const ac = p.xc.ac ? c.s.cfg[p.pe].acs[p.xc.ac] : undefined;
      return [p.pe, p.xc.ac ? acName(c, p.xc.ac) : "—", ac?.vlan ? String(ac.vlan) : "—", p.xc.pwid !== undefined ? String(p.xc.pwid) : "—", p.xc.nbr ?? "—", String(p.local), p.remote ? String(p.remote.label) : "unknown", p.remote ? `${p.mtu} / ${p.remote.mtu}` : `${p.mtu} / ?`, p.cw ? "on" : "off", p.up ? ["up", "ok"] : [pwWhyText(p, c.s.os), "bad"]] as (string | [string, "ok" | "bad"])[];
    });
  return <STable cols={["PE", "AC", "VLAN", "PW ID", "Neighbor", "Receives on", "Pushes", "MTU local / remote", "CW", "State"]} rows={rows} empty="No cross-connects." />;
}
function Ldp({ c }: { c: Ctx }) {
  const v = c.live.view;
  const rows = [
    ...VP_LINKS.map((l) => [`${l.a} – ${l.b}`, "link", v.ldp[l.id] ? ["Operational", "ok"] : ["none", "bad"]] as (string | [string, "ok" | "bad"])[]),
    ["PE1 – PE2", `targeted (PE1 → ${v.tldp.tries.PE1.join(", ") || "—"}; PE2 → ${v.tldp.tries.PE2.join(", ") || "—"})`, v.tldp.up ? ["Operational", "ok"] : ["none", "bad"]] as (string | [string, "ok" | "bad"])[],
  ];
  return <STable cols={["Session", "Kind", "State"]} rows={rows} />;
}
function Lsp({ c }: { c: Ctx }) {
  const v = c.live.view;
  const rows = VP_ROUTERS.flatMap((r) =>
    [VP_LO.PE1, VP_LO.PE2].filter((fec) => VP_LO[r] !== fec).map((fec) => {
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
  const tr = vpForward(c.s.cfg, c.s.view, c.s.os, t.from, t.dst);
  return <STable cols={["Hop", "Label stack (top first)", "What happened"]} rows={tr.hops.map((h) => [`${h.from} → ${h.to}`, h.labels.length ? h.labels.join(" / ") : "Ethernet", spText(c.vendor, h.note)])} />;
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
      {t.why && <p className="text-[11.5px] text-pv-warning">{spText(c.vendor, t.why)}</p>}
    </div>
  );
}
function Ladder({ c }: { c: Ctx }) {
  if (c.busy) return <p className="text-[12px] text-pv-text-faint">The ladder fills in when the run has finished.</p>;
  return (
    <ol className="space-y-1">
      {vpLadder(c.s).map((r, i) => (
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
      return card("Cross-connects and pseudowires", <Pws c={c} />);
    case "ldp":
      return card("LDP sessions (link and targeted)", <Ldp c={c} />);
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
function cfgDiff(a: VpCfg, b: VpCfg): string {
  const out: string[] = [];
  for (const k of new Set([...Object.keys(a.acs), ...Object.keys(b.acs)])) {
    const x = a.acs[k];
    const y = b.acs[k];
    if (!x) out.push(`${k} created`);
    else if (!y) out.push(`${k} removed`);
    else if (JSON.stringify(x) !== JSON.stringify(y)) out.push(`${k} changed`);
  }
  const key = (x: VpCfg["xcs"][number]) => `${x.group}/${x.name}`;
  for (const x of b.xcs) {
    const o = a.xcs.find((y) => key(y) === key(x));
    if (!o) out.push(`cross-connect ${x.ac ?? x.name} created`);
    else if (JSON.stringify(o) !== JSON.stringify(x)) out.push(`cross-connect ${x.ac ?? x.name} changed`);
  }
  for (const x of a.xcs) if (!b.xcs.some((y) => key(y) === key(x))) out.push(`cross-connect ${x.ac ?? x.name} removed`);
  if (JSON.stringify(a.pwClasses) !== JSON.stringify(b.pwClasses)) out.push("pw-class changed");
  for (const k of Object.keys(b.ldp) as IfName[]) if (!!a.ldp[k] !== !!b.ldp[k]) out.push(`${k} LDP ${b.ldp[k] ? "on" : "off"}`);
  if (a.ldpLo !== b.ldpLo) out.push(`LDP on lo0.0 ${b.ldpLo ? "on" : "off"}`);
  return out.join(", ") || "no change";
}
function devCli(c: Ctx, r: VpR): SpDevCli<VpCfg> {
  return {
    host: r,
    running: c.s.cfg[r],
    hist: c.s.hist[r],
    cand: c.cli.cand[r] as VpCfg | undefined,
    setCand: (x) => c.cli.setCand(r, x),
    xr: c.cli.xr[r] ?? [],
    setXr: (st) => c.cli.setXr(r, st),
    edit: !!c.cli.edit[r],
    setEdit: (b) => c.cli.setEdit(r, b),
    commit: (cfg, how) => c.act({ type: "cfg", dev: r, cfg, text: `${cfgDiff(c.s.cfg[r], cfg)} (${how}, ${c.vendor === "cisco" ? "IOS XR" : "Junos"})` }),
    ask: c.cli.setQuestion,
  };
}
function RouterUI({ c, r }: { c: Ctx; r: VpR }) {
  const pe = VP_PES.includes(r);
  const [tab, setTab] = useState<"svc" | "labels" | "term" | "log">(pe ? "svc" : "labels");
  const s = c.s;
  const cfg = s.cfg[r];
  const change = (f: (x: VpCfg) => void) => {
    const n = spClone(cfg);
    f(n);
    c.act({ type: "cfg", dev: r, cfg: n, text: `${cfgDiff(cfg, n)} (from ${r}'s window)` });
  };
  const api: VpCliApi = { s, act: c.act, dev: devCli(c, r) };
  return (
    <div>
      <Tabs tabs={[...(pe ? ([["svc", "Services"]] as ["svc", string][]) : []), ["labels", "Labels & LDP"], ["term", "Console"], ["log", "Log"]]} cur={tab} set={setTab} />
      <div className="space-y-2 p-3">
        {tab === "svc" && pe && (
          <>
            {c.live.view.pws.filter((p) => p.pe === r).map((p) => (
              <Card key={`${p.xc.group}/${p.xc.name}/${p.idx}`} title={<span style={{ color: p.xc.ac?.endsWith(".200") ? CUST_TONE["CUST-B"] : CUST_TONE["CUST-A"] }}>{c.vendor === "cisco" ? `${p.xc.group} / ${p.xc.name}` : `l2circuit ${p.xc.ac ?? "?"}`}</span>}>
                <div className="grid gap-x-4 sm:grid-cols-2">
                  <Kv k="Attachment circuit" v={p.xc.ac ? `${acName(c, p.xc.ac)} · VLAN ${cfg.acs[p.xc.ac]?.vlan ?? "none"}` : "none"} tone={p.xc.ac && cfg.acs[p.xc.ac] ? undefined : "bad"} />
                  <Kv k="Pseudowire" v={p.xc.nbr ? `${p.xc.nbr} · PW ID ${p.xc.pwid}` : "none"} tone={p.xc.nbr ? undefined : "bad"} />
                  <Kv k="Labels" v={`receives on ${p.local} · pushes ${p.remote?.label ?? "unknown"}`} tone={p.remote ? undefined : "warn"} />
                  <Kv k="MTU · control word" v={`${p.mtu} · ${p.cw ? "on" : "off"}`} />
                  <Kv k="State" v={p.up ? "up" : spText(c.vendor, pwWhyText(p, s.os))} tone={p.up ? "ok" : "bad"} />
                </div>
              </Card>
            ))}
            <p className="text-[11.5px] text-pv-text-faint">Attachment circuits, cross-connects and pseudowire settings are configured in the Console (candidate + commit).</p>
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
                  {VP_LINKS.filter((l) => l.a === r || l.b === r).map((l) => {
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
        {tab === "term" && <SpConsole c={c.cli} sets={vpSets(api, r)} os={c.vendor === "cisco" ? "iosxr" : "junos"} host={r} vendor={c.vendor} setVendor={c.setVendor} pipeCtx={c.vendor === "juniper" ? vpPipe(api, r) : undefined} />}
        {tab === "log" && (
          <ul className="space-y-0.5">
            {s.sys.filter((x) => x.dev === r).slice(-30).reverse().map((x, i) => (
              <li key={i} className="pv-mono text-[11.5px] text-pv-text-muted">
                {spStamp(x.t).hms} {x.kind === "commit" ? "configuration committed" : x.kind.startsWith("pw") ? `pseudowire ${x.pwid} to ${x.peer} ${x.kind === "pw-up" ? "up" : "down"}` : `LDP ${x.peer} ${x.kind === "ldp-up" ? "up" : "down"}`}
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
const HOSTS = ["192.168.100.1", "192.168.100.2"];
function Composer({ c }: { c: Ctx }) {
  const [from, setFrom] = useState<VpCe>("CE1A");
  const [to, setTo] = useState("192.168.100.2");
  const sel = "rounded border border-pv-border bg-pv-bg px-1 py-0.5 text-[12px] text-pv-text";
  return (
    <div className="space-y-2 rounded-xl border border-pv-border p-2">
      <p className="text-[12px] font-semibold text-pv-text">Customer traffic</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <select aria-label="From" className={sel} value={from} onChange={(e) => setFrom(e.target.value as VpCe)}>
          {VP_CES.map((x) => (
            <option key={x} value={x}>
              {x} ({CES[x].cust}, {CES[x].ip})
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
          <Pill onClick={() => c.act({ type: "wipe-a" })} disabled={c.busy || !!c.s.wiped} tone="danger">
            Wipe PE2&apos;s CUST-A service
          </Pill>
          <span className="text-[11.5px] text-pv-text-faint">for challenge 5</span>
        </div>
      )}
    </div>
  );
}

const SPEC: SpLabSpec<VpState, VpAction, VpSnap> = {
  title: "L2VPN (VPWS) Lab",
  note: () => "CUST-A and CUST-B · same IP addresses · PE1 ↔ PE2 pseudowires",
  fresh: (seq, vendor) => createVpNet(seq, vendor === "cisco" ? "xr" : "junos"),
  vendorAction: (v) => ({ type: "os", os: v === "cisco" ? "xr" : "junos" }),
  apply: vpApply,
  snapOf: (s) => ({ view: s.view }),
  ticketAction: (id) => ({ type: "ticket", id: id as VpTicketId }),
  levels: VP_LEVELS,
  gate: {
    title: "You can follow an Ethernet frame through a pseudowire",
    points: [
      "An attachment circuit (port + VLAN) decides which service a frame belongs to; the PEs never look at the customer's IP addresses.",
      "The two PEs signal each pseudowire over a targeted LDP session between their loopbacks: same PW ID, same MTU, same control-word setting.",
      "Labels are directional: each PE pushes the label the other PE chose.",
      "The ingress PE pushes the PW label and the transport label; the core switches only the transport label.",
      "A pseudowire that shows up can still carry nothing: check the attachment circuits and the transport underneath.",
    ],
    more: "The engineering workspace gives you PE1, P1, P2 and PE2 in their own windows (services, labels and LDP, an IOS XR / Junos console with commit), pings from all four customer sites, five challenges and five tickets.",
  },
  stage,
  footer: (c) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
      <span>
        Targeted LDP: <b className="pv-mono text-pv-text">{c.s.view.tldp.up ? "up" : "down"}</b> · pseudowires up {c.s.view.pws.filter((p) => p.up).length}/{c.s.view.pws.length}
      </span>
      <span className="text-pv-text-faint">CE colors: violet CUST-A · amber CUST-B</span>
    </div>
  ),
  devices: VP_ROUTERS,
  device: (id, c) => ({ label: id, icon: role(id), tone: "#22d3ee", sub: `${VP_LO[id as VpR]} · ${c.vendor === "cisco" ? "IOS XR" : "Junos"} view` }),
  openFrom: 1,
  window: (id, c) => <RouterUI c={c} r={id as VpR} />,
  tools: [
    { id: "pws", label: "Pseudowires", render: (c) => <Pws c={c} /> },
    { id: "ldp", label: "LDP sessions", render: (c) => <Ldp c={c} /> },
    { id: "lsp", label: "Transport labels", render: (c) => <Lsp c={c} /> },
    { id: "path", label: "Last label stack", render: (c) => <PathView c={c} /> },
    { id: "log", label: "Log", render: (c) => <LogTool c={c} /> },
  ],
  toolsLabel: { learn: "What the routers know", eng: "Tools" },
  evidence,
  composer: (c) => <Composer c={c} />,
  investigate: [
    "On PE1, show l2vpn xconnect detail (IOS XR) or show l2circuit connections (Junos): find the label PE1 receives on and the label it pushes for each service. Who chose each?",
    "show mpls ldp discovery on PE1: besides the link hellos, where do the targeted hellos go?",
    "Ping 192.168.100.2 from CE1A and from CE1B. Same address — why does each reach its own site?",
    "On P1, try show l2vpn xconnect. Why is there nothing to show?",
    "Change one end's control word or MTU and watch the pseudowire go down on both PEs.",
  ],
  challenges: VP_CHALLENGES,
  tickets: VP_TICKETS.map((t) => ({ id: t.id, title: t.title, report: t.report, reproLabel: t.reproLabel, repro: t.repro })),
  ticketIntro: "Customers report symptoms, not causes. Each ticket is this network after a change with one real thing wrong. Reproduce it, walk the evidence (attachment circuits, targeted LDP, the pseudowires, the transport LSP), name the cause, fix it on the router and prove it with a fresh ping.",
  reproHint: "Watch where the frame stops and what each PE says about the pseudowire.",
  fixHint: "Fix it on the router (its console — commit to apply), check the pseudowires, then run the ping again. A pseudowire that shows up isn't proof by itself.",
  causes: VP_CAUSES,
  feedback: vpCauseFeedback,
  proofs: vpProofs,
  ladder: (s) => vpLadder(s),
  text: (v, t) => spText(v, t),
  runCard: (c) => (
    <Card title="Result">
      <TestView c={c} />
    </Card>
  ),
};

export function VpwsLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SpLabWorkspace spec={SPEC} open={open} onClose={onClose} />;
}
