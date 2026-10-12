"use client";

import { useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { SpLabWorkspace, type SpCtx, type SpLabSpec } from "@/components/sp-lab/SpLabWorkspace";
import { SpStage, type SpPath, type SpStageLink, type SpStageNode } from "@/components/sp-lab/SpStage";
import { SpConsole } from "@/components/sp-lab/SpDesk";
import { Card, Kv, Pill, STable, Tabs } from "@/components/sp-lab/SpUi";
import { spClone, type SpMoment } from "@/components/sp-lab/spKit";
import type { SpDevCli } from "@/components/sp-lab/spCli";
import type { TopoView } from "@/components/presentation/Visuals";
import { PA } from "@/lib/sim-engine/scenarios/troubleshootingPacketAnalysis";
import {
  BAD_GW,
  CAP_PTS,
  GOOD_GW,
  IFACES,
  PA_CAUSES,
  PA_TICKETS,
  bracket,
  clockText,
  createPaNet,
  ctr,
  frameLabel,
  lastTest,
  outcomeText,
  paApply,
  paCauseFeedback,
  paLadder,
  paProofs,
  pcapFilter,
  type CapPt,
  type PaAction,
  type PaD,
  type PaJCfg,
  type PaSnap,
  type PaState,
  type PaTicketId,
  paStamp,
} from "@/lib/sim-engine/scenarios/paNet";
import { paPipe, paSets, type PaCliApi } from "./paCli";
import { PA_LEVELS } from "./paLearn";
import { PA_CHALLENGES } from "./paPractice";

/**
 * Packet Analysis Lab — the guided lesson's CLIENT — SW1 — R1 — SERVER network with five live capture points (CLIENT
 * eth0, SW1's mirror feeding CAPTURE, R1 ge-0/0/0 and ge-0/0/1, SERVER eth0), interface counters and real consoles
 * (Junos on SW1/R1, Linux on the hosts).
 *   LEARN                  6 levels (paLearn)
 *   ENGINEERING WORKSPACE  Investigate (connection tests, pings, the capture viewer, the capture comparison, counters,
 *                          device windows) · Challenges (five) · Troubleshoot (five tickets)
 * One model (paNet.ts) produces every frame, capture row, counter and result.
 */

type Ctx = SpCtx<PaState, PaAction, PaSnap>;
const POS: Record<PaD, { x: number; y: number; cx: number; cy: number }> = {
  CLIENT: { x: 9, y: 62, cx: 12, cy: 49 },
  SW1: { x: 27, y: 38, cx: 31, cy: 25 },
  R1: { x: 64, y: 38, cx: 63, cy: 25 },
  SERVER: { x: 90, y: 62, cx: 88, cy: 49 },
  CAPTURE: { x: 27, y: 84, cx: 31, cy: 71 },
};
const SUB: Record<PaD, string> = { CLIENT: `${PA.client}/24`, SW1: "switch · SPAN", R1: `${PA.gw} | ${PA.r1Srv}`, SERVER: `${PA.server}:443`, CAPTURE: "capture laptop" };
const ROLE: Record<PaD, string> = { CLIENT: "host", SW1: "SW", R1: "R", SERVER: "srv", CAPTURE: "cap" };

function stage(c: Ctx, p: { moment?: SpMoment<PaSnap>; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) {
  const s = c.s;
  const nodes: SpStageNode[] = (Object.keys(POS) as PaD[]).map((d) => ({ id: d, label: d, role: ROLE[d], tone: d === "CAPTURE" ? "#fbbf24" : d === "CLIENT" || d === "SERVER" ? "#34d399" : "#22d3ee", sub: p.compact && (d === "CLIENT" || d === "SERVER") ? (d === "CLIENT" ? PA.client : PA.server) : SUB[d], ...POS[d] }));
  const links: SpStageLink[] = [
    { id: "L-C-SW1", a: "CLIENT", b: "SW1", state: "up", label: "eth0 · ge-0/0/1" },
    { id: "L-SW1-R1", a: "SW1", b: "R1", state: "up", label: "ge-0/0/24 · ge-0/0/0", at: 0.44 },
    { id: "L-R1-S", a: "R1", b: "SERVER", state: "up", label: "ge-0/0/1 · eth0" },
    { id: "L-SW1-CAP", a: "SW1", b: "CAPTURE", state: s.cfg.SW1.analyzer ? "up" : "down", label: "mirror ge-0/0/23" },
  ];
  const t = lastTest(s);
  const views: Record<string, TopoView> = {};
  const paths: SpPath[] = [];
  if (!p.moment && t && t.cfgSeq === s.cfgSeq) {
    views.CLIENT = { badge: { text: t.outcome === "ok" ? (t.synRetx ? "slow" : "ok") : t.outcome, tone: t.outcome === "ok" && !t.synRetx ? "info" : "warn" } };
    paths.push({ id: "w", nodes: ["CLIENT", "SW1", "R1", "SERVER"], color: t.outcome === "ok" ? "#a78bfa" : "#f87171", offset: 0 });
  }
  return <SpStage nodes={nodes} links={links} paths={paths} views={views} moment={p.moment} momentKey={p.momentKey} compact={p.compact} onNode={p.onNode} selected={p.selected} regions={[{ x: 2, y: 22, w: 45, h: 72, label: "10.10.10.0/24", color: "#22d3ee" }, { x: 78, y: 40, w: 20, h: 40, label: "10.20.20.0/24", color: "#a78bfa" }]} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------------------------
type Cell = string | [string, "ok" | "bad" | "warn"];
function TestView({ c }: { c: Ctx }) {
  const t = lastTest(c.s);
  if (!t) return <p className="text-[12px] text-pv-text-faint">Run a test above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The result appears when the run has finished.</p>;
  const ok = t.outcome === "ok";
  return (
    <div className={clsx("rounded-lg border px-2 py-1 text-[12.5px]", ok && !t.synRetx ? "border-pv-success/40" : "border-pv-danger/40")}>
      <p className="font-semibold text-pv-text">
        {t.kind === "ping" ? `ping ${PA.server}` : `${t.kind === "nc" ? "nc" : "curl"} → ${PA.server}:443 (source port ${t.sport})`}: <span className={ok && !t.synRetx ? "text-pv-success" : "text-pv-danger"}>{outcomeText(t)}</span>
      </p>
      <p className="text-[11.5px] text-pv-text-muted">
        started {clockText(t.t0)} · {t.frames.length} frames · SYN retransmissions {t.synRetx} · data retransmissions {t.dataRetx}
      </p>
    </div>
  );
}
function Bracket({ c }: { c: Ctx }) {
  const t = lastTest(c.s);
  if (!t) return <p className="text-[12px] text-pv-text-faint">Run a test above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The comparison appears when the run has finished.</p>;
  const rows = bracket(c.s, t).map((b) => [`${(b.f.t - t.t0).toFixed(6)}`, b.f.dir === "c2s" ? "→" : b.f.dir === "s2c" ? "←" : "SERVER", frameLabel(b.f), ...CAP_PTS.map((p) => (b.seen[p.id] ? "✓" : ["—", "warn"] as [string, "warn"]))] as Cell[]);
  return (
    <div className="space-y-1">
      <STable cols={["t (s)", "dir", "frame", ...CAP_PTS.map((p) => p.label)]} rows={rows} />
      <p className="text-[11px] text-pv-text-faint">✓ = present in that capture. A frame missing from a capture was either lost before that point or never mirrored there.</p>
    </div>
  );
}
function Captures({ c, fixed }: { c: Ctx; fixed?: CapPt }) {
  const [pt, setPt] = useState<CapPt>(fixed ?? "client");
  const [flt, setFlt] = useState("");
  const cur = fixed ?? pt;
  const f = pcapFilter(flt);
  const rows = typeof f === "string" ? [] : c.s.caps[cur].filter(f);
  return (
    <div className="space-y-1.5">
      {!fixed && (
        <div className="flex flex-wrap gap-1">
          {CAP_PTS.map((p) => (
            <Pill key={p.id} onClick={() => setPt(p.id)} tone={pt === p.id ? "primary" : undefined}>
              {p.label}
            </Pill>
          ))}
        </div>
      )}
      <input aria-label="Capture filter" className="w-full rounded border border-pv-border bg-pv-bg px-2 py-1 pv-mono text-[12px] text-pv-text" placeholder="filter: host 10.20.20.20 and port 443 · tcp · arp · icmp · not arp" value={flt} onChange={(e) => setFlt(e.target.value)} />
      {typeof f === "string" && <p className="text-[11.5px] text-pv-warning">{f}</p>}
      <STable
        cols={["no.", "time", ...(cur.startsWith("r1") ? ["dir"] : []), "source", "destination", "TTL", "info"]}
        rows={rows.slice(-60).map((r) => [String(r.n), clockText(r.t), ...(cur.startsWith("r1") ? [r.dirAt] : []), r.frame.src + (r.frame.sport ? `:${r.frame.sport}` : ""), r.frame.dst + (r.frame.dport ? `:${r.frame.dport}` : ""), r.ttl ? String(r.ttl) : "—", r.frame.retx ? [`${r.frame.kind === "tcp" ? `[${r.frame.flags}] seq ${r.frame.seq} ack ${r.frame.ack ?? 0} len ${r.frame.len}` : r.frame.text} [TCP retransmission]`, "warn"] : r.frame.kind === "tcp" ? `[${r.frame.flags}] seq ${r.frame.seq}${r.frame.flags !== "S" ? ` ack ${r.frame.ack}` : ""} len ${r.frame.len}` : r.frame.text] as Cell[])}
      />
      <p className="text-[11px] text-pv-text-faint">{CAP_PTS.find((p) => p.id === cur)!.where} · {rows.length} frames{rows.length > 60 ? " (last 60 shown)" : ""} · absolute TCP numbers</p>
    </div>
  );
}
function Counters({ c }: { c: Ctx }) {
  const s = c.s;
  const rows = IFACES.map((i) => {
    const v = s.counters[i.key];
    const base = s.snapshot?.[i.key];
    return [i.key, String(v.in), String(v.out), v.drops ? [String(v.drops), "bad"] : "0", base ? `+${v.in - base.in} / +${v.out - base.out} / +${v.drops - base.drops}` : "—"] as Cell[];
  });
  return (
    <div className="space-y-1">
      <STable cols={["interface", "in", "out", "drops", "Δ since snapshot (in/out/drops)"]} rows={rows} />
      <p className="text-[11px] text-pv-text-faint">Lifetime counters. Junos `show interfaces` subtracts the last `clear interfaces statistics`; the lab&apos;s snapshot is a separate baseline for deltas.</p>
    </div>
  );
}
function PathView({ c }: { c: Ctx }) {
  const run = [...c.s.runs].reverse().find((r) => r.kind === "test");
  if (!run) return <p className="text-[12px] text-pv-text-faint">Run a test above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The walk appears when the run has finished.</p>;
  return (
    <ol className="space-y-0.5">
      {run.moments.map((m, i) => (
        <li key={i} className={clsx("text-[12px]", m.lines[0]?.tone === "warn" || m.lines[0]?.tone === "bad" ? "text-pv-warning" : m.lines[0]?.tone === "ok" ? "text-pv-success" : "text-pv-text-muted")}>
          {m.lines[0]?.text}
        </li>
      ))}
    </ol>
  );
}
function Ladder({ c }: { c: Ctx }) {
  if (c.busy) return <p className="text-[12px] text-pv-text-faint">The ladder fills in when the run has finished.</p>;
  return (
    <ol className="space-y-1">
      {paLadder(c.s).map((r, i) => (
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
    case "test":
      return card("What the test did", <TestView c={c} />);
    case "bracket":
      return card("The last test, frame by frame, at every capture point", <Bracket c={c} />);
    case "captures":
      return card("Capture viewer", <Captures c={c} />);
    case "counters":
      return card("Interface counters", <Counters c={c} />);
    case "ladder":
      return card("The evidence ladder, read from the network", <Ladder c={c} />);
    case "path":
      return card("What happened, frame by frame", <PathView c={c} />);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Device windows
// ---------------------------------------------------------------------------------------------------------------
function cfgDiff(a: PaJCfg, b: PaJCfg): string {
  const out: string[] = [];
  if (!!a.shape !== !!b.shape) out.push(b.shape ? "shaping-rate 64k on ge-0/0/0" : "shaper removed from ge-0/0/0");
  const an = (x?: PaJCfg["analyzer"]) => (x ? `${x.ingress ? "ingress" : ""}${x.ingress && x.egress ? "+" : ""}${x.egress ? "egress" : ""}` || "no inputs" : "none");
  if (an(a.analyzer) !== an(b.analyzer)) out.push(`analyzer CAP: ${an(b.analyzer)}`);
  return out.join(", ") || "no change";
}
function devCli(c: Ctx, r: "SW1" | "R1"): SpDevCli<PaJCfg> {
  return {
    host: r,
    running: c.s.cfg[r],
    hist: c.s.hist[r],
    cand: c.cli.cand[r] as PaJCfg | undefined,
    setCand: (x) => c.cli.setCand(r, x),
    xr: c.cli.xr[r] ?? [],
    setXr: (st) => c.cli.setXr(r, st),
    edit: !!c.cli.edit[r],
    setEdit: (b) => c.cli.setEdit(r, b),
    commit: (cfg, how) => c.act({ type: "cfg", dev: r, cfg, text: `${cfgDiff(c.s.cfg[r], cfg)} (${how}, Junos)` }),
    ask: c.cli.setQuestion,
  };
}
const hostApi = (c: Ctx, d: PaD): PaCliApi => ({ s: c.s, act: c.act, dev: { host: d, running: {}, hist: [], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } });
type Tab = "main" | "cap" | "term" | "log";
function DeviceUI({ c, d }: { c: Ctx; d: PaD }) {
  const [tab, setTab] = useState<Tab>(d === "CAPTURE" ? "cap" : "main");
  const s = c.s;
  const isJ = d === "SW1" || d === "R1";
  const api: PaCliApi = isJ ? { s, act: c.act, dev: devCli(c, d) } : hostApi(c, d);
  const change = (f: (x: PaJCfg) => void) => {
    if (!isJ) return;
    const n = spClone(s.cfg[d]);
    f(n);
    c.act({ type: "cfg", dev: d, cfg: n, text: `${cfgDiff(s.cfg[d], n)} (from ${d}'s window)` });
  };
  const host = (f: (h: PaState["hosts"]) => void, text: string) => c.act({ type: "host", dev: d, f, text });
  const tabs: [Tab, string][] = d === "CAPTURE" ? [["cap", "SPAN capture"], ["term", "Console"]] : [["main", isJ ? "Interfaces" : "Host"], ...(d === "CLIENT" || d === "SERVER" ? ([["cap", "eth0 capture"]] as [Tab, string][]) : []), ["term", "Console"], ["log", "Log"]];
  const ifRows = IFACES.filter((i) => i.dev === d).map((i) => {
    const v = ctr(s, i.key);
    return [i.ifn, String(v.in), String(v.out), v.drops ? [String(v.drops), "bad"] : "0"] as Cell[];
  });
  return (
    <div>
      <Tabs tabs={tabs} cur={tab} set={setTab} />
      <div className="space-y-2 p-3">
        {tab === "main" && isJ && (
          <>
            <Card title={`${d} · interface counters (since last clear)`}>
              <STable cols={["interface", "in", "out", "output drops"]} rows={ifRows} />
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Pill onClick={() => c.act({ type: "clear-stats", ifn: undefined })} disabled={c.busy}>
                  clear interfaces statistics all
                </Pill>
              </div>
            </Card>
            {d === "R1" && (
              <Card title="Class of service · ge-0/0/0">
                <Kv k="Shaping rate" v={s.cfg.R1.shape ? "64000 bps" : "none (line rate)"} tone={s.cfg.R1.shape ? "warn" : undefined} />
                <div className="mt-1.5">
                  <Pill onClick={() => change((x) => void (x.shape = !x.shape))} disabled={c.busy}>
                    {s.cfg.R1.shape ? "delete the shaper" : "set shaping-rate 64k"}
                  </Pill>
                </div>
              </Card>
            )}
            {d === "SW1" && (
              <Card title="Analyzer session CAP (port mirroring)">
                {s.cfg.SW1.analyzer ? (
                  <>
                    <Kv k="Mirror frames received on ge-0/0/1" v={s.cfg.SW1.analyzer.ingress ? "yes" : "no"} tone={s.cfg.SW1.analyzer.ingress ? undefined : "warn"} />
                    <Kv k="Mirror frames sent out of ge-0/0/1" v={s.cfg.SW1.analyzer.egress ? "yes" : "no"} tone={s.cfg.SW1.analyzer.egress ? undefined : "warn"} />
                    <Kv k="Output" v="ge-0/0/23 → CAPTURE" />
                  </>
                ) : (
                  <p className="text-[12px] text-pv-warning">No analyzer session.</p>
                )}
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Pill onClick={() => change((x) => void (x.analyzer = { ingress: !(x.analyzer?.ingress ?? false), egress: x.analyzer?.egress ?? false }))} disabled={c.busy}>
                    toggle ingress
                  </Pill>
                  <Pill onClick={() => change((x) => void (x.analyzer = { ingress: x.analyzer?.ingress ?? false, egress: !(x.analyzer?.egress ?? false) }))} disabled={c.busy}>
                    toggle egress
                  </Pill>
                </div>
              </Card>
            )}
          </>
        )}
        {tab === "main" && d === "CLIENT" && (
          <Card title={`CLIENT · ${PA.client}/24 · gateway ${PA.gw}`}>
            <Kv k="ARP entry for the gateway" v={s.hosts.clientArp ? "REACHABLE" : "none"} />
            <Kv k="Last socket" v={s.clientSock ? `${PA.client}:${s.clientSock.sport} → ${PA.server}:443 ${s.clientSock.state}` : "—"} />
            <STable cols={["interface", "rx", "tx", "drops"]} rows={ifRows} />
          </Card>
        )}
        {tab === "main" && d === "SERVER" && (
          <Card title={`SERVER · ${PA.server}/24`}>
            <Kv k="nginx (TCP/443)" v={s.hosts.nginx ? "active (running)" : "inactive (dead)"} tone={s.hosts.nginx ? undefined : "warn"} />
            <Kv k="iptables INPUT" v={s.hosts.drop443 ? `DROP tcp dpt:443 (${s.iptDropPkts} pkts)` : "policy ACCEPT, no rules"} tone={s.hosts.drop443 ? "warn" : undefined} />
            <Kv k="Default gateway" v={s.hosts.gw} tone={s.hosts.gw === GOOD_GW ? undefined : "warn"} />
            <Kv k="Half-open sockets (SYN-RECV)" v={s.synRecv.length ? s.synRecv.map((p) => `:${p}`).join(" ") : "none"} />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Pill onClick={() => host((h) => void (h.nginx = !h.nginx), `systemctl ${s.hosts.nginx ? "stop" : "start"} nginx`)} disabled={c.busy}>
                {s.hosts.nginx ? "stop nginx" : "start nginx"}
              </Pill>
              <Pill onClick={() => host((h) => void (h.drop443 = !h.drop443), `iptables ${s.hosts.drop443 ? "-D" : "-A"} INPUT -p tcp --dport 443 -j DROP`)} disabled={c.busy}>
                {s.hosts.drop443 ? "delete the DROP rule" : "add DROP tcp/443"}
              </Pill>
              <Pill onClick={() => host((h) => void (h.gw = h.gw === GOOD_GW ? BAD_GW : GOOD_GW), `ip route replace default via ${s.hosts.gw === GOOD_GW ? BAD_GW : GOOD_GW}`)} disabled={c.busy}>
                gateway → {s.hosts.gw === GOOD_GW ? BAD_GW : GOOD_GW}
              </Pill>
            </div>
          </Card>
        )}
        {tab === "cap" && <Captures c={c} fixed={d === "CAPTURE" ? "span" : d === "CLIENT" ? "client" : "server"} />}
        {tab === "term" && <SpConsole c={c.cli} sets={paSets(api, d)} os={isJ ? "junos" : "linux"} host={d} vendor="juniper" pipeCtx={isJ ? paPipe(api, d) : undefined} />}
        {tab === "log" && (
          <ul className="space-y-0.5">
            {s.sys.filter((x) => x.dev === d).slice(-30).reverse().map((x, i) => (
              <li key={i} className="pv-mono text-[11.5px] text-pv-text-muted">
                {paStamp(x.t).hms} {x.text}
              </li>
            ))}
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
          <span className="pv-mono text-pv-text-faint">{paStamp(l.t).hms}</span> {l.text}
        </li>
      ))}
    </ul>
  );
}
function Composer({ c }: { c: Ctx }) {
  return (
    <div className="space-y-2 rounded-xl border border-pv-border p-2">
      <p className="text-[12px] font-semibold text-pv-text">CLIENT → SERVER {PA.server}:443</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <Pill onClick={() => c.act({ type: "nc" })} disabled={c.busy} tone="primary">
          nc -vz (connect test)
        </Pill>
        <Pill onClick={() => c.act({ type: "curl" })} disabled={c.busy}>
          curl the portal
        </Pill>
        <Pill onClick={() => c.act({ type: "ping", count: 4 })} disabled={c.busy}>
          ping ×4
        </Pill>
        <Pill onClick={() => c.act({ type: "snapshot" })} disabled={c.busy}>
          snapshot counters
        </Pill>
        <Pill onClick={() => c.act({ type: "clear-caps" })} disabled={c.busy}>
          clear captures
        </Pill>
        <Pill onClick={() => c.act({ type: "flush-arp" })} disabled={c.busy}>
          flush CLIENT ARP
        </Pill>
        <Pill onClick={() => c.act({ type: "wipe-analyzer" })} disabled={c.busy || !c.s.cfg.SW1.analyzer} tone="danger">
          Delete SW1 mirror
        </Pill>
      </div>
      <p className="text-[11.5px] text-pv-text-faint">Captures run at all five points. Open a device to read its capture, counters and console.</p>
    </div>
  );
}

const SPEC: SpLabSpec<PaState, PaAction, PaSnap> = {
  title: "Packet Analysis Lab",
  note: () => "five capture points · Junos + Linux",
  fresh: (seq) => createPaNet(seq),
  vendors: ["juniper"],
  apply: paApply,
  snapOf: (s) => ({ frames: s.frames.slice(-20) }),
  ticketAction: (id) => ({ type: "ticket", id: id as PaTicketId }),
  levels: PA_LEVELS,
  gate: {
    title: "You can read the evidence",
    points: [
      "One flow is one five-tuple; IPs, ports and TCP numbers survive routing, TTL and MAC addresses do not.",
      "SYN-ACK acknowledges ISN + 1; data advances the sequence by its length; SYN and FIN consume one number.",
      "Refusal is instant (RST); loss is silent and costs a retransmission timeout (1 s, then 2 s).",
      "Bracket a loss between the last capture that has the frame and the first that doesn't — then confirm with a counter there.",
      "Check how a capture was taken before trusting its silence.",
    ],
    more: "The engineering workspace gives you five live captures with filters, a frame-by-frame comparison, interface counters with snapshots, every device in its own window (Junos consoles on SW1 and R1, Linux shells on the hosts and the capture laptop), five challenges and five tickets.",
  },
  stage,
  footer: (c) => {
    const t = lastTest(c.s);
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
        <span>
          Last test: <b className="text-pv-text">{t ? outcomeText(t) : "none"}</b>
        </span>
        <span>{c.s.tests.length} tests · {c.s.frames.length} frames captured</span>
      </div>
    );
  },
  devices: ["CLIENT", "SW1", "R1", "SERVER", "CAPTURE"],
  device: (id) => ({ label: id, icon: ROLE[id as PaD], tone: id === "CAPTURE" ? "#fbbf24" : "#22d3ee", sub: id === "SW1" || id === "R1" ? `${SUB[id as PaD]} · Junos` : `${SUB[id as PaD]} · Linux` }),
  openFrom: 1,
  window: (id, c) => <DeviceUI c={c} d={id as PaD} />,
  tools: [
    { id: "bracket", label: "Compare captures", render: (c) => <Bracket c={c} /> },
    { id: "captures", label: "Capture viewer", render: (c) => <Captures c={c} /> },
    { id: "counters", label: "Counters", render: (c) => <Counters c={c} /> },
    { id: "path", label: "Last test, frame by frame", render: (c) => <PathView c={c} /> },
    { id: "log", label: "Log", render: (c) => <LogTool c={c} /> },
  ],
  toolsLabel: { learn: "What the captures show", eng: "Tools" },
  evidence,
  composer: (c) => <Composer c={c} />,
  investigate: [
    "Run curl, then open the capture viewer: which fields differ between CLIENT eth0 and SERVER eth0 for the same SYN?",
    "On CLIENT: tcpdump -nn -r /var/tmp/eth0.pcap, then tcpdump -nnS -r … — what changes in the sequence numbers?",
    "Stop nginx in SERVER's window and connect: how long until CLIENT knows? Then add the DROP rule instead — what changes?",
    "On R1: show interfaces ge-0/0/0 extensive and show interfaces queue ge-0/0/0 — where would a drop be counted?",
    "On SW1: show forwarding-options analyzer — what exactly does the CAPTURE laptop receive?",
  ],
  challenges: PA_CHALLENGES,
  tickets: PA_TICKETS.map((t) => ({ id: t.id, title: t.title, report: t.report, reproLabel: t.reproLabel, repro: t.repro })),
  ticketIntro: "Users describe a symptom; captures and counters hold the answer. Each ticket is this network after a change with one real fault. Reproduce it, compare the captures, form a hypothesis, test it with a second source (counters, sockets, rules, routes), name the cause, fix it, and prove it with fresh traffic.",
  reproHint: "Compare the captures: how far does each frame get? Is anything retransmitted, refused or never answered?",
  fixHint: "Fix it on the device (window or console — Junos needs commit), then run the same test again.",
  causes: PA_CAUSES,
  feedback: paCauseFeedback,
  proofs: paProofs,
  ladder: (s) => paLadder(s),
  runCard: (c) => (
    <Card title="Result">
      <TestView c={c} />
    </Card>
  ),
};

export function PaLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SpLabWorkspace spec={SPEC} open={open} onClose={onClose} />;
}
