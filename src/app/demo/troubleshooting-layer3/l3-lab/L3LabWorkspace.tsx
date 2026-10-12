"use client";

import { useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { SpLabWorkspace, type SpCtx, type SpLabSpec } from "@/components/sp-lab/SpLabWorkspace";
import { SpStage, type SpStageLink, type SpStageNode } from "@/components/sp-lab/SpStage";
import { SpConsole } from "@/components/sp-lab/SpDesk";
import { Card, Kv, Pill, STable, Tabs } from "@/components/sp-lab/SpUi";
import { spStamp, type SpMoment } from "@/components/sp-lab/spKit";
import type { SpDevCli } from "@/components/sp-lab/spCli";
import type { TopoView } from "@/components/presentation/Visuals";
import { L3 } from "@/lib/sim-engine/scenarios/troubleshootingLayer3";
import {
  DEV_LABEL,
  L3_CAUSES,
  L3_TICKETS,
  RTR_IFS,
  createL3Net,
  hostRoutes,
  l3Apply,
  l3CauseFeedback,
  l3Ladder,
  l3Proofs,
  lastTest,
  lpm,
  rtrRoutes,
  srcIpOf,
  testOk,
  testText,
  type L3Action,
  type L3D,
  type L3H,
  type L3R,
  type L3State,
  type L3TicketId,
  type RCfg,
} from "@/lib/sim-engine/scenarios/l3tsNet";
import { l3Pipe, l3Sets, type L3CliApi } from "./l3Cli";
import { L3_LEVELS } from "./l3Learn";
import { L3_CHALLENGES } from "./l3Practice";

/**
 * Layer 3 Lab — the guided lesson's CLIENT — SW1 — R1 — R2 network with SERVER and REMOTE-SERVER behind R2: every host's
 * routing decision, ARP caches, both routers' tables, ping and traceroute walked hop by hop with real TTLs and ICMP
 * errors, and real consoles (Junos on the routers, Linux on the hosts).
 *   LEARN                  6 levels (l3Learn)
 *   ENGINEERING WORKSPACE  Investigate · Challenges (five) · Troubleshoot (five tickets)
 * One model (l3tsNet.ts) produces every reading.
 */

type Ctx = SpCtx<L3State, L3Action, unknown>;
const POS: Record<L3D, { x: number; y: number; cx: number; cy: number }> = {
  CLIENT: { x: 9, y: 72, cx: 11, cy: 74 },
  SW1: { x: 26, y: 72, cx: 34, cy: 74 },
  R1: { x: 40, y: 38, cx: 36, cy: 36 },
  R2: { x: 64, y: 38, cx: 64, cy: 36 },
  SERVER: { x: 90, y: 20, cx: 88, cy: 16 },
  REMOTE: { x: 90, y: 76, cx: 86, cy: 74 },
};
const SUB: Record<L3D, string> = { CLIENT: `${L3.client}`, SW1: "switch", R1: "router", R2: "router", SERVER: L3.server, REMOTE: L3.remote };
const ROLE: Record<L3D, string> = { CLIENT: "host", SW1: "SW", R1: "R", R2: "R", SERVER: "srv", REMOTE: "srv" };
const isR = (d: L3D): d is L3R => d === "R1" || d === "R2";
const isH = (d: L3D): d is L3H => d === "CLIENT" || d === "SERVER" || d === "REMOTE";

function stage(c: Ctx, p: { moment?: SpMoment; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) {
  const s = c.s;
  const nodes: SpStageNode[] = (Object.keys(POS) as L3D[]).map((d) => ({ id: d, label: DEV_LABEL[d], role: ROLE[d], tone: isR(d) ? "#a78bfa" : d === "SW1" ? "#22d3ee" : "#34d399", sub: d === "CLIENT" ? (p.compact ? s.hosts.CLIENT.addrs.map((a) => `/${a.len}`).join(" ") || "no addr" : s.hosts.CLIENT.addrs.map((a) => `${a.ip}/${a.len}`).join(" ") || "no address") : SUB[d], ...POS[d] }));
  const up = (r: L3R, ifn: string) => !s.rtrs[r].ifs[ifn]?.disable;
  const links: SpStageLink[] = [
    { id: "L-C-S", a: "CLIENT", b: "SW1", state: "up" },
    { id: "L-S-R1", a: "SW1", b: "R1", state: up("R1", "ge-0/0/0") ? "up" : "down", label: "ge-0/0/0" },
    { id: "L-R1-R2", a: "R1", b: "R2", state: up("R1", "ge-0/0/1") && up("R2", "ge-0/0/0") ? "up" : "down", label: "192.0.2.0/31" },
    { id: "L-R2-S", a: "R2", b: "SERVER", state: up("R2", "ge-0/0/1") ? "up" : "down", label: "ge-0/0/1" },
    { id: "L-R2-RM", a: "R2", b: "REMOTE", state: up("R2", "ge-0/0/2") ? "up" : "down", label: "ge-0/0/2" },
  ];
  const t = lastTest(s);
  const views: Record<string, TopoView> = {};
  if (!p.moment && t && t.cfgSeq === s.cfgSeq) views[t.from] = { badge: { text: t.kind === "trace" ? (t.reached ? "trace ok" : "trace ✗") : t.error ? t.error.replace("Destination ", "") : `${t.recv}/${t.sent}`, tone: testOk(t) ? "info" : "warn" } };
  return <SpStage nodes={nodes} links={links} views={views} moment={p.moment} momentKey={p.momentKey} compact={p.compact} onNode={p.onNode} selected={p.selected} regions={[{ x: 2, y: 56, w: 31, h: 34, label: "10.10.10.0/24", color: "#22d3ee" }, { x: 78, y: 4, w: 20, h: 32, label: "10.20.20.0/24", color: "#34d399" }, { x: 76, y: 60, w: 22, h: 34, label: "10.10.20.0/24", color: "#a78bfa" }]} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------------------------
type Cell = string | [string, "ok" | "bad" | "warn"];
function TestView({ c }: { c: Ctx }) {
  const t = lastTest(c.s);
  if (!t) return <p className="text-[12px] text-pv-text-faint">Run a test above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The result appears when the run has finished.</p>;
  return (
    <div className={clsx("rounded-lg border px-2 py-1 text-[12.5px]", testOk(t) ? "border-pv-success/40" : "border-pv-danger/40")}>
      <p className={clsx("font-semibold", testOk(t) ? "text-pv-success" : "text-pv-danger")}>
        {DEV_LABEL[t.from]}: {testText(t)}
      </p>
      <p className="text-[11.5px] text-pv-text-muted">started {spStamp(t.t0).hms}</p>
    </div>
  );
}
function DecisionView({ c }: { c: Ctx }) {
  const s = c.s;
  const h = s.hosts.CLIENT;
  const rs = hostRoutes(h);
  const rows = [L3.gw, L3.server, L3.remote].map((dst) => {
    const r = lpm(rs, dst);
    return [dst, r ? (r.kind === "default" ? `0.0.0.0/0 via ${r.nh}` : `${r.prefix}/${r.len} on-link`) : ["no route", "bad"], r ? (r.kind === "default" ? `ARP for ${r.nh}` : `ARP for ${dst}`) : "—", r ? srcIpOf(s, "CLIENT", dst) : "—"] as Cell[];
  });
  return (
    <div className="space-y-1">
      <Kv k="CLIENT" v={`${h.addrs.map((a) => `${a.ip}/${a.len}`).join(", ") || "no address"} · gateway ${h.gw ?? "none"}`} />
      <STable cols={["destination", "matching route (longest prefix)", "next step", "source IP"]} rows={rows} />
      <p className="text-[11px] text-pv-text-faint">The connected route comes from the address and prefix length; the default route only wins when nothing longer matches.</p>
    </div>
  );
}
function ArpView({ c }: { c: Ctx }) {
  const s = c.s;
  const rows: Cell[][] = [];
  for (const d of ["CLIENT", "R1", "R2", "SERVER", "REMOTE"] as L3D[]) for (const [ip, e] of Object.entries(s.arp[d])) rows.push([DEV_LABEL[d], ip, e.state === "FAILED" ? ["FAILED", "bad"] : (e.mac ?? "").toLowerCase(), e.ifn]);
  return (
    <div className="space-y-1">
      {rows.length ? <STable cols={["device", "IP", "MAC", "interface"]} rows={rows} /> : <p className="text-[12px] text-pv-text-faint">No ARP entries yet — send traffic.</p>}
      <p className="text-[11px] text-pv-text-faint">R1 has received {s.arpRx.R1} ARP requests in this session, {s.arpNotForMe.R1} of them for addresses that aren&apos;t R1&apos;s.</p>
    </div>
  );
}
function RoutesView({ c }: { c: Ctx }) {
  const s = c.s;
  return (
    <div className="space-y-2">
      {(["R1", "R2"] as L3R[]).map((r) => (
        <div key={r}>
          <p className="text-[12px] font-semibold text-pv-text">{r} · inet.0</p>
          <STable cols={["prefix", "protocol", "next hop", "interface"]} rows={rtrRoutes(s.rtrs[r]).map((x) => [`${x.prefix}/${x.len}`, x.kind, x.nh ?? (x.kind === "Local" ? "local" : "direct"), x.ifn ?? "—"])} />
        </div>
      ))}
    </div>
  );
}
function TraceView({ c }: { c: Ctx }) {
  const t = [...c.s.tests].reverse().find((x) => x.kind === "trace");
  if (!t) return <p className="text-[12px] text-pv-text-faint">Run a traceroute.</p>;
  return <STable cols={["hop", "answered from", "note"]} rows={(t.hops ?? []).map((h, i) => [String(i + 1), h ?? ["* * *", "warn"], h === t.dst ? "destination" : t.error?.startsWith("!N") && i === t.hops!.length - 1 ? "!N — net unreachable" : h ? "time exceeded" : "no reply came back"] as Cell[])} />;
}
function PathView({ c }: { c: Ctx }) {
  const run = [...c.s.runs].reverse()[0];
  if (!run) return <p className="text-[12px] text-pv-text-faint">Run a test above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The walk appears when the run has finished.</p>;
  return (
    <ol className="space-y-1">
      {run.moments.map((m, i) => (
        <li key={i} className="text-[12px]">
          {m.lines.map((l, j) => (
            <p key={j} className={clsx(l.tone === "bad" ? "text-pv-danger" : l.tone === "ok" ? "text-pv-success" : "text-pv-text-muted")}>
              {l.text}
            </p>
          ))}
          {m.tokens.length > 0 && <p className="pv-mono text-[11px] text-pv-text-faint">{m.tokens.slice(0, 12).map((t) => `${DEV_LABEL[t.from as L3D] ?? t.from}→${DEV_LABEL[t.to as L3D] ?? t.to} ${t.label}`).join(" · ")}{m.tokens.length > 12 ? " …" : ""}</p>}
        </li>
      ))}
    </ol>
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
    case "decision":
      return card("CLIENT's routing decision", <DecisionView c={c} />);
    case "arp":
      return card("ARP caches", <ArpView c={c} />);
    case "routes":
      return card("The routers' tables", <RoutesView c={c} />);
    case "trace":
      return card("traceroute", <TraceView c={c} />);
    case "path":
      return card("What happened, hop by hop", <PathView c={c} />);
    case "test":
      return card("What the test showed", <TestView c={c} />);
    case "ladder":
      return card("The evidence ladder, read from the network", <Ladder c={c} />);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Device windows
// ---------------------------------------------------------------------------------------------------------------
function cfgDiff(r: L3R, a: RCfg, b: RCfg): string {
  const out: string[] = [];
  for (const ifn of RTR_IFS[r]) {
    const x = a.ifs[ifn] ?? {};
    const y = b.ifs[ifn] ?? {};
    if (!!x.disable !== !!y.disable) out.push(`${ifn} ${y.disable ? "disabled" : "enabled"}`);
    if (x.addr !== y.addr || x.len !== y.len) out.push(`${ifn} ${y.addr ? `${y.addr}/${y.len}` : "no address"}`);
  }
  const k = (st: RCfg["statics"]) => st.map((x) => `${x.prefix}/${x.len}>${x.nh}`).sort().join(",");
  if (k(a.statics) !== k(b.statics)) out.push(`static routes: ${b.statics.map((x) => `${x.prefix}/${x.len} → ${x.nh}`).join(", ") || "none"}`);
  return out.join("; ") || "no change";
}
function devCli(c: Ctx, r: L3R): SpDevCli<RCfg> {
  return {
    host: r,
    running: c.s.rtrs[r],
    hist: c.s.hist[r],
    cand: c.cli.cand[r] as RCfg | undefined,
    setCand: (x) => c.cli.setCand(r, x),
    xr: c.cli.xr[r] ?? [],
    setXr: (st) => c.cli.setXr(r, st),
    edit: !!c.cli.edit[r],
    setEdit: (b) => c.cli.setEdit(r, b),
    commit: (cfg, how) => c.act({ type: "cfg", dev: r, cfg, text: `${cfgDiff(r, c.s.rtrs[r], cfg)} (${how}, Junos)` }),
    ask: c.cli.setQuestion,
  };
}
const hostApi = (c: Ctx, d: L3D): L3CliApi => ({ s: c.s, act: c.act, dev: { host: d, running: { ifs: {}, statics: [] }, hist: [], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } });
type Tab = "main" | "term" | "log";
function DeviceUI({ c, d }: { c: Ctx; d: L3D }) {
  const [tab, setTab] = useState<Tab>("main");
  const s = c.s;
  if (d === "SW1")
    return (
      <div className="space-y-2 p-3">
        <Card title="SW1 · unmanaged access switch">
          <p className="text-[12px] text-pv-text-muted">A plain Layer 2 switch: it forwards frames by MAC address and never touches IP or TTL. It has no console.</p>
          <STable cols={["MAC", "port"]} rows={Object.entries(s.sw1).map(([m, p]) => [m.toLowerCase(), p])} />
        </Card>
      </div>
    );
  const api: L3CliApi = isR(d) ? { s, act: c.act, dev: devCli(c, d) } : hostApi(c, d);
  const tabs: [Tab, string][] = [["main", isR(d) ? "Routes" : "Network"], ["term", "Console"], ...(isR(d) ? ([["log", "Log"]] as [Tab, string][]) : [])];
  return (
    <div>
      <Tabs tabs={tabs} cur={tab} set={setTab} />
      <div className="space-y-2 p-3">
        {tab === "main" && isR(d) && (
          <>
            <Card title={`${d} · interfaces`}>
              <STable cols={["interface", "address", "state", "faces"]} rows={RTR_IFS[d].map((ifn) => { const i = s.rtrs[d].ifs[ifn] ?? {}; return [ifn, i.addr ? `${i.addr}/${i.len}` : "—", i.disable ? ["disabled", "bad"] : "up", ifn === "ge-0/0/0" ? (d === "R1" ? "CLIENT LAN" : "R1") : ifn === "ge-0/0/1" ? (d === "R1" ? "R2" : "SERVER LAN") : "REMOTE LAN"] as Cell[]; })} />
            </Card>
            <Card title={`${d} · inet.0`}>
              <STable cols={["prefix", "protocol", "next hop", "interface"]} rows={rtrRoutes(s.rtrs[d]).map((x) => [`${x.prefix}/${x.len}`, x.kind, x.nh ?? (x.kind === "Local" ? "local" : "direct"), x.ifn ?? "—"])} />
              <div className="mt-1.5">
                <Pill onClick={() => c.act({ type: "clear-arp", dev: d })} disabled={c.busy}>
                  clear arp
                </Pill>
              </div>
            </Card>
          </>
        )}
        {tab === "main" && isH(d) && (
          <Card title={`${DEV_LABEL[d]} · eth0`}>
            <Kv k="Addresses" v={s.hosts[d].addrs.map((a) => `${a.ip}/${a.len}`).join(", ") || "none"} />
            <Kv k="Routes" v={hostRoutes(s.hosts[d]).map((r) => (r.kind === "default" ? `default via ${r.nh}` : `${r.prefix}/${r.len} on-link`)).join(" · ") || "none"} />
            {Object.entries(s.arp[d]).map(([ip, e]) => (
              <Kv key={ip} k={`ARP ${ip}`} v={e.state === "FAILED" ? "FAILED" : `${e.mac?.toLowerCase()} REACHABLE`} tone={e.state === "FAILED" ? "warn" : undefined} />
            ))}
          </Card>
        )}
        {tab === "term" && <SpConsole c={c.cli} sets={l3Sets(api, d)} os={isR(d) ? "junos" : "linux"} host={DEV_LABEL[d]} vendor="juniper" pipeCtx={isR(d) ? l3Pipe(api, d) : undefined} />}
        {tab === "log" && (
          <ul className="space-y-0.5">
            {s.sys.filter((x) => x.dev === d).slice(-30).reverse().map((x, i) => (
              <li key={i} className="pv-mono text-[11.5px] text-pv-text-muted">
                {spStamp(x.t).hms} {x.text}
              </li>
            ))}
            {!s.sys.some((x) => x.dev === d) && <li className="text-[12px] text-pv-text-faint">No events yet.</li>}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Composer, spec
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
  const p = (dst: string): L3Action => ({ type: "ping", from: "CLIENT", dst, count: 4 });
  return (
    <div className="space-y-2 rounded-xl border border-pv-border p-2">
      <p className="text-[12px] font-semibold text-pv-text">From CLIENT ({c.s.hosts.CLIENT.addrs.map((a) => `${a.ip}/${a.len}`).join(", ") || "no address"})</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <Pill onClick={() => c.act(p(L3.server))} disabled={c.busy} tone="primary">
          ping SERVER
        </Pill>
        <Pill onClick={() => c.act(p(L3.remote))} disabled={c.busy}>
          ping REMOTE-SERVER
        </Pill>
        <Pill onClick={() => c.act(p(L3.gw))} disabled={c.busy}>
          ping gateway
        </Pill>
        <Pill onClick={() => c.act({ type: "trace", from: "CLIENT", dst: L3.server })} disabled={c.busy}>
          traceroute SERVER
        </Pill>
        <Pill onClick={() => c.act({ type: "trace", from: "CLIENT", dst: L3.remote })} disabled={c.busy}>
          traceroute REMOTE-SERVER
        </Pill>
      </div>
      <p className="text-[11.5px] text-pv-text-faint">Open a device for its addresses, routes, ARP cache and console.</p>
    </div>
  );
}

const SPEC: SpLabSpec<L3State, L3Action, unknown> = {
  title: "Layer 3 Lab",
  note: () => "ARP, addressing, forwarding · Junos + Linux",
  fresh: (seq) => createL3Net(seq),
  vendors: ["juniper"],
  apply: l3Apply,
  snapOf: () => undefined,
  ticketAction: (id) => ({ type: "ticket", id: id as L3TicketId }),
  levels: L3_LEVELS,
  gate: {
    title: "You can follow a packet through routers",
    points: [
      "A host's own address, prefix length and default route decide on-link or gateway — longest prefix wins.",
      "ARP resolves the next hop only; the frame goes to the gateway's MAC while the IP destination stays the final host.",
      "Each router looks up the destination, decrements TTL and resolves its own next hop.",
      "Routers report what they can't forward (net unreachable, time exceeded); a missing return route fails silently.",
      "The prefix length can make a remote host look local — and the router never sees the packet.",
    ],
    more: "The engineering workspace gives you CLIENT's routing decision, every ARP cache, both routers' tables, ping and traceroute walked hop by hop, every device in its own window (Junos consoles on R1 and R2, Linux shells on the hosts), five challenges and five tickets.",
  },
  stage,
  footer: (c) => {
    const t = lastTest(c.s);
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
        <span>
          Last: <b className="text-pv-text">{t ? `${DEV_LABEL[t.from]} ${testText(t)}` : "none"}</b>
        </span>
      </div>
    );
  },
  devices: ["CLIENT", "SW1", "R1", "R2", "SERVER", "REMOTE"],
  device: (id) => ({ label: DEV_LABEL[id as L3D], icon: ROLE[id as L3D], tone: isR(id as L3D) ? "#a78bfa" : "#22d3ee", sub: isR(id as L3D) ? "router · Junos" : id === "SW1" ? "unmanaged switch" : `${SUB[id as L3D]} · Linux` }),
  openFrom: 1,
  window: (id, c) => <DeviceUI c={c} d={id as L3D} />,
  tools: [
    { id: "decision", label: "CLIENT's decision", render: (c) => <DecisionView c={c} /> },
    { id: "arp", label: "ARP caches", render: (c) => <ArpView c={c} /> },
    { id: "routes", label: "Router tables", render: (c) => <RoutesView c={c} /> },
    { id: "trace", label: "traceroute", render: (c) => <TraceView c={c} /> },
    { id: "path", label: "Last run, hop by hop", render: (c) => <PathView c={c} /> },
    { id: "log", label: "Log", render: (c) => <LogTool c={c} /> },
  ],
  toolsLabel: { learn: "What the network shows", eng: "Tools" },
  evidence,
  composer: (c) => <Composer c={c} />,
  investigate: [
    "On CLIENT: ip route, then ip route get 10.20.20.20 and ip route get 10.10.20.20 — which route does each use?",
    "Ping SERVER, then ip neigh on CLIENT: whose MAC does CLIENT know — SERVER's or R1's?",
    "On R1: show route and show route 10.10.20.20 — which entry wins, and why?",
    "traceroute -n 10.20.20.20 on CLIENT: why does hop 2 show 192.0.2.1?",
    "Give CLIENT a /16 (sudo ip addr del … add …): which server still works, and what does R1's show system statistics arp say?",
  ],
  challenges: L3_CHALLENGES,
  tickets: L3_TICKETS.map((t) => ({ id: t.id, title: t.title, report: t.report, reproLabel: t.reproLabel, repro: t.repro })),
  ticketIntro: "Users describe a symptom; the hosts' and routers' tables hold the answer. Each ticket is this network after one configuration change. Reproduce it, read the routing decisions and ARP caches, follow the packet hop by hop, name the cause, fix it and prove it with fresh pings to both servers.",
  reproHint: "Does the failure come with an error (from whom?) or silence? What does CLIENT decide for each destination? Did ARP succeed?",
  fixHint: "Fix it on the device: Junos needs commit; Linux changes take effect at once. Then ping both servers again.",
  causes: L3_CAUSES,
  feedback: l3CauseFeedback,
  proofs: l3Proofs,
  ladder: (s) => l3Ladder(s),
  runCard: (c) => (
    <Card title="Result">
      <TestView c={c} />
    </Card>
  ),
};

export function L3LabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SpLabWorkspace spec={SPEC} open={open} onClose={onClose} />;
}
