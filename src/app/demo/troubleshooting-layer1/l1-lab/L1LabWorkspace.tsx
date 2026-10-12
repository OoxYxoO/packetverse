"use client";

import { useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { SpLabWorkspace, type SpCtx, type SpLabSpec } from "@/components/sp-lab/SpLabWorkspace";
import { SpStage, type SpStageLink, type SpStageNode } from "@/components/sp-lab/SpStage";
import { SpConsole } from "@/components/sp-lab/SpDesk";
import { Card, Kv, Pill, STable, Tabs } from "@/components/sp-lab/SpUi";
import { spClone, spStamp, type SpMoment } from "@/components/sp-lab/spKit";
import type { SpDevCli } from "@/components/sp-lab/spCli";
import type { TopoView } from "@/components/presentation/Visuals";
import { L1_IP, UPLINK, WINDOW_S, rxBand } from "@/lib/sim-engine/scenarios/troubleshootingLayer1";
import {
  BREAKS,
  IF_HOST,
  IPERF_GOOD,
  L1_CAUSES,
  L1_TICKETS,
  PHYS,
  SW_IFS,
  SW_KEYS,
  createL1Net,
  dbmText,
  l1Apply,
  l1CauseFeedback,
  l1Ladder,
  l1Proofs,
  l1View,
  lastTest,
  snapDelta,
  swCtr,
  testText,
  type CopperLink,
  type L1Action,
  type L1D,
  type L1Host,
  type L1JCfg,
  type L1State,
  type L1Sw,
  type L1TicketId,
} from "@/lib/sim-engine/scenarios/l1Net";
import { l1Pipe, l1Sets, l1Validate, type L1CliApi } from "./l1Cli";
import { L1_LEVELS } from "./l1Learn";
import { L1_CHALLENGES } from "./l1Practice";

/**
 * Layer 1 Lab — the guided lesson's CLIENT — ACCESS-SW — DIST-SW — SERVER network with a 1000BASE-LX fiber uplink:
 * link state and negotiation on every port, optical levels at both ends, error counters with snapshots, ping and iperf3
 * tests, a field kit for physical work, and real consoles (Junos EX on the switches, Linux on the hosts).
 *   LEARN                  6 levels (l1Learn)
 *   ENGINEERING WORKSPACE  Investigate · Challenges (five) · Troubleshoot (five tickets)
 * One model (l1Net.ts) produces every reading.
 */

type Ctx = SpCtx<L1State, L1Action, unknown>;
const POS: Record<L1D, { x: number; y: number; cx: number; cy: number }> = {
  CLIENT: { x: 10, y: 68, cx: 13, cy: 62 },
  "ACCESS-SW": { x: 30, y: 36, cx: 30, cy: 30 },
  "DIST-SW": { x: 70, y: 36, cx: 70, cy: 30 },
  SERVER: { x: 90, y: 68, cx: 87, cy: 62 },
};
const SUB: Record<L1D, string> = { CLIENT: L1_IP.CLIENT, "ACCESS-SW": "access · EX", "DIST-SW": "distribution · EX", SERVER: L1_IP.SERVER };
const ROLE: Record<L1D, string> = { CLIENT: "host", "ACCESS-SW": "SW", "DIST-SW": "SW", SERVER: "srv" };
const isSw = (d: L1D): d is L1Sw => d === "ACCESS-SW" || d === "DIST-SW";

function stage(c: Ctx, p: { moment?: SpMoment; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) {
  const s = c.s;
  const v = l1View(s);
  const nodes: SpStageNode[] = (Object.keys(POS) as L1D[]).map((d) => ({ id: d, label: d, role: ROLE[d], tone: isSw(d) ? "#22d3ee" : "#34d399", sub: p.compact && isSw(d) ? (d === "ACCESS-SW" ? "access" : "distribution") : SUB[d], ...POS[d] }));
  const st = (up: boolean, sick: boolean): SpStageLink["state"] => (!up ? "down" : sick ? "blocked" : "up");
  const links: SpStageLink[] = [
    { id: "L-C-A", a: "CLIENT", b: "ACCESS-SW", state: st(v.client.up, v.client.mismatch || v.client.downshift), label: v.client.up ? `${v.client.speed === 1000 ? "1G" : `${v.client.speed}M`} · ge-0/0/1` : "down · ge-0/0/1" },
    { id: "L-UP", a: "ACCESS-SW", b: "DIST-SW", state: st(v.uplink.up, rxBand(v.uplink.rxA) === "marginal"), label: `${UPLINK} · fiber${v.uplink.up ? "" : " · down"}` },
    { id: "L-D-S", a: "DIST-SW", b: "SERVER", state: st(v.server.up, v.server.mismatch), label: v.server.up ? `${v.server.speed === 1000 ? "1G" : `${v.server.speed}M`} · ge-0/0/2` : "down · ge-0/0/2" },
  ];
  const t = [...s.tests].reverse().find((x) => x.kind !== "wait");
  const views: Record<string, TopoView> = {};
  if (!p.moment && t && t.cfgSeq === s.cfgSeq) {
    const good = t.kind === "ping" ? !t.unreachable && t.recv === t.sent : (t.mbps ?? 0) >= IPERF_GOOD;
    views.CLIENT = { badge: { text: t.kind === "ping" ? (t.unreachable ? "unreachable" : `${t.recv}/${t.sent}`) : t.unreachable ? "no conn" : `${t.mbps} Mb/s`, tone: good ? "info" : "warn" } };
  }
  return <SpStage nodes={nodes} links={links} views={views} moment={p.moment} momentKey={p.momentKey} compact={p.compact} onNode={p.onNode} selected={p.selected} regions={[{ x: 2, y: 14, w: 96, h: 78, label: "10.30.30.0/24 · one broadcast domain", color: "#22d3ee" }]} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------------------------
type Cell = string | [string, "ok" | "bad" | "warn"];
const cuRow = (name: string, l: CopperLink): Cell[] => [
  name,
  l.adminDown ? ["admin down", "bad"] : "up",
  l.up ? "up" : ["down", "bad"],
  l.up ? (l.downshift ? [`${l.speed} Mb/s (downshift)`, "warn"] : `${l.speed} Mb/s`) : "—",
  l.up ? (l.mismatch ? [`${l.swDuplex} / ${l.hostDuplex}`, "bad"] : `${l.swDuplex} / ${l.hostDuplex}`) : "—",
  `${l.swAuto ? "on" : "off"} / ${l.hostAuto ? "on" : "off"}`,
];
function LinksView({ c }: { c: Ctx }) {
  const v = l1View(c.s);
  const up: Cell[] = ["ACCESS ge-0/0/47 ↔ DIST ge-0/0/47 (fiber)", v.uplink.adminA && v.uplink.adminD ? "up / up" : [`${v.uplink.adminA ? "up" : "down"} / ${v.uplink.adminD ? "up" : "down"}`, "bad"], v.uplink.up ? (rxBand(v.uplink.rxA) === "marginal" ? ["up (marginal Rx)", "warn"] : "up") : ["down", "bad"], "1000 Mb/s", "full", "1000BASE-X"];
  return (
    <div className="space-y-1">
      <STable cols={["link", "admin state", "link state", "speed", "duplex (switch / host)", "auto-neg (switch / host)"]} rows={[cuRow("CLIENT eth0 ↔ ACCESS ge-0/0/1", v.client), up, cuRow("DIST ge-0/0/2 ↔ SERVER eth0", v.server)]} />
      {[v.client, v.uplink, v.server].some((l) => l.why) && <p className="text-[11.5px] text-pv-warning">{[v.client.why && `CLIENT link: ${v.client.why}`, v.uplink.why && `uplink: ${v.uplink.why}`, v.server.why && `SERVER link: ${v.server.why}`].filter(Boolean).join(" · ")}</p>}
    </div>
  );
}
function OpticsView({ c }: { c: Ctx }) {
  const v = l1View(c.s);
  const band = (x: number): Cell => (x <= -40 ? ["no light (LOS)", "bad"] : rxBand(x) === "normal" ? "normal" : rxBand(x) === "marginal" ? ["marginal", "warn"] : ["loss of signal", "bad"]);
  return (
    <div className="space-y-1">
      <STable cols={["end", "Tx", "Rx", "Rx band"]} rows={[["ACCESS-SW ge-0/0/47", dbmText(v.uplink.txA), dbmText(v.uplink.rxA), band(v.uplink.rxA)], ["DIST-SW ge-0/0/47", dbmText(v.uplink.txD), dbmText(v.uplink.rxD), band(v.uplink.rxD)]]} />
      <p className="text-[11px] text-pv-text-faint">Rx at one end = the other end&apos;s Tx minus the strand&apos;s loss (healthy ≈ 1.2 dB). Bands (the optic&apos;s thresholds): normal ≥ −14 dBm · marginal down to −22 dBm (link stays up, bits misread) · below: loss of signal.</p>
    </div>
  );
}
function CountersView({ c }: { c: Ctx }) {
  const s = c.s;
  const d = snapDelta(s);
  const rows = SW_KEYS.map((k) => {
    const x = swCtr(s, k);
    const dd = d?.d[k];
    return [k.replace(":", " "), String(x.inPkts), x.crc ? [String(x.crc), "warn"] : "0", x.runts ? [String(x.runts), "warn"] : "0", String(x.carrier), dd ? (dd.crc || dd.runts ? [`+${dd.crc} / +${dd.runts} / +${dd.carrier}`, "bad"] : `+0 / +0 / +${dd.carrier}`) : "—"] as Cell[];
  });
  return (
    <div className="space-y-1">
      <STable cols={["interface", "in packets", "CRC/align", "runts", "carrier transitions", d ? `Δ last ${d.secs} s (CRC / runts / carrier)` : "Δ (take two snapshots)"]} rows={rows} />
      <p className="text-[11px] text-pv-text-faint">Counters since the last clear (Junos subtracts `clear interfaces statistics`). Snapshots: {s.snaps.length}{d ? ` · last pair ${d.a.label} → ${d.b.label}` : ""}. A delta means something only with traffic in between and a known interval (≥ {WINDOW_S} s here).</p>
    </div>
  );
}
function TestView({ c }: { c: Ctx }) {
  const t = [...c.s.tests].reverse().find((x) => x.kind !== "wait");
  if (!t) return <p className="text-[12px] text-pv-text-faint">Run a test above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The result appears when the run has finished.</p>;
  const good = t.kind === "ping" ? !t.unreachable && t.recv === t.sent : (t.mbps ?? 0) >= IPERF_GOOD;
  return (
    <div className={clsx("rounded-lg border px-2 py-1 text-[12.5px]", good ? "border-pv-success/40" : "border-pv-danger/40")}>
      <p className={clsx("font-semibold", good ? "text-pv-success" : "text-pv-danger")}>{testText(t)}</p>
      <p className="text-[11.5px] text-pv-text-muted">
        CLIENT {L1_IP.CLIENT} → SERVER {L1_IP.SERVER} · started {spStamp(t.t0).hms} · {t.secs} s
      </p>
    </div>
  );
}
function PathView({ c }: { c: Ctx }) {
  const run = [...c.s.runs].reverse()[0];
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
      {l1Ladder(c.s).map((r, i) => (
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
    case "links":
      return card("Every link: admin, operational, speed, duplex", <LinksView c={c} />);
    case "optics":
      return card("The uplink's light, both ends", <OpticsView c={c} />);
    case "counters":
      return card("Error counters and the last snapshot delta", <CountersView c={c} />);
    case "test":
      return card("What the test measured", <TestView c={c} />);
    case "ladder":
      return card("The evidence ladder, read from the network", <Ladder c={c} />);
    case "path":
      return card("What happened, step by step", <PathView c={c} />);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Device windows
// ---------------------------------------------------------------------------------------------------------------
function cfgDiff(r: L1Sw, a: L1JCfg, b: L1JCfg): string {
  const out: string[] = [];
  for (const ifn of SW_IFS[r]) {
    const x = a.ifs[ifn] ?? {};
    const y = b.ifs[ifn] ?? {};
    if (!!x.disable !== !!y.disable) out.push(`${ifn} ${y.disable ? "disabled" : "enabled"}`);
    const e = (o: typeof x) => `${o.eth?.speed ?? ""}|${o.eth?.linkMode ?? ""}|${o.eth?.noAuto ? "noauto" : ""}`;
    if (e(x) !== e(y)) out.push(`${ifn} ${y.eth ? [y.eth.speed && `speed ${y.eth.speed}`, y.eth.linkMode, y.eth.noAuto && "no-auto-negotiation"].filter(Boolean).join(", ") : "auto-negotiation restored"}`);
  }
  return out.join("; ") || "no change";
}
function devCli(c: Ctx, r: L1Sw): SpDevCli<L1JCfg> {
  return {
    host: r,
    running: c.s.sw[r],
    hist: c.s.hist[r],
    cand: c.cli.cand[r] as L1JCfg | undefined,
    setCand: (x) => c.cli.setCand(r, x),
    xr: c.cli.xr[r] ?? [],
    setXr: (st) => c.cli.setXr(r, st),
    edit: !!c.cli.edit[r],
    setEdit: (b) => c.cli.setEdit(r, b),
    commit: (cfg, how) => c.act({ type: "cfg", dev: r, cfg, text: `${cfgDiff(r, c.s.sw[r], cfg)} (${how}, Junos)` }),
    ask: c.cli.setQuestion,
    validate: l1Validate,
  };
}
const hostApi = (c: Ctx, d: L1D): L1CliApi => ({ s: c.s, act: c.act, dev: { host: d, running: { ifs: {} }, hist: [], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } });
type Tab = "main" | "optics" | "field" | "term" | "log";
function FieldKit({ c, d }: { c: Ctx; d: L1D }) {
  const acts = PHYS.filter((p) => p.dev === d);
  return (
    <Card title="Field work (physical actions take about 20 s and flap the link)">
      <div className="flex flex-col gap-1.5">
        {acts.map((p) => (
          <Pill key={p.id} onClick={() => c.act({ type: "phys", id: p.id })} disabled={c.busy}>
            {p.label}
          </Pill>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-pv-text-faint">Physical work changes what the cable or optic does — the readings show whether it helped.</p>
    </Card>
  );
}
function DeviceUI({ c, d }: { c: Ctx; d: L1D }) {
  const [tab, setTab] = useState<Tab>("main");
  const s = c.s;
  const v = l1View(s);
  const sw = isSw(d);
  const api: L1CliApi = sw ? { s, act: c.act, dev: devCli(c, d) } : hostApi(c, d);
  const change = (f: (x: L1JCfg) => void) => {
    if (!sw) return;
    const n = spClone(s.sw[d]);
    f(n);
    c.act({ type: "cfg", dev: d, cfg: n, text: `${cfgDiff(d, s.sw[d], n)} (from ${d}'s window)` });
  };
  const tabs: [Tab, string][] = [["main", sw ? "Interfaces" : "Link"], ...(sw ? ([["optics", "Optics"]] as [Tab, string][]) : []), ["field", "Field work"], ["term", "Console"], ["log", "Log"]];
  const host = d as L1Host;
  const hl = d === "CLIENT" ? v.client : v.server;
  return (
    <div>
      <Tabs tabs={tabs} cur={tab} set={setTab} />
      <div className="space-y-2 p-3">
        {tab === "main" && sw && (
          <Card title={`${d} · interfaces (counters since last clear)`}>
            <STable
              cols={["interface", "admin", "link", "speed / duplex", "CRC/align", "runts", "carrier"]}
              rows={SW_IFS[d].map((ifn) => {
                const x = swCtr(s, `${d}:${ifn}`);
                const fiber = ifn === UPLINK;
                const l = fiber ? undefined : d === "ACCESS-SW" ? v.client : v.server;
                const admin = fiber ? (d === "ACCESS-SW" ? v.uplink.adminA : v.uplink.adminD) : !l!.adminDown;
                const up = fiber ? v.uplink.up : l!.up;
                return [ifn, admin ? "up" : ["down", "bad"], up ? "up" : ["down", "bad"], up ? (fiber ? "1000 / full" : `${l!.speed} / ${l!.swDuplex}`) : "—", x.crc ? [String(x.crc), "warn"] : "0", x.runts ? [String(x.runts), "warn"] : "0", String(x.carrier)] as Cell[];
              })}
            />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Pill onClick={() => c.act({ type: "clear-stats", dev: d })} disabled={c.busy}>
                clear interfaces statistics all
              </Pill>
              <Pill onClick={() => change((x) => void ((x.ifs[IF_HOST[d]] ??= {}).disable = !x.ifs[IF_HOST[d]]?.disable))} disabled={c.busy}>
                {s.sw[d].ifs[IF_HOST[d]]?.disable ? `enable ${IF_HOST[d]}` : `disable ${IF_HOST[d]}`}
              </Pill>
              {s.sw[d].ifs[IF_HOST[d]]?.eth && (
                <Pill onClick={() => change((x) => void delete x.ifs[IF_HOST[d]].eth)} disabled={c.busy}>
                  restore auto-negotiation on {IF_HOST[d]}
                </Pill>
              )}
              <Pill onClick={() => c.act({ type: "tdr", dev: d })} disabled={c.busy}>
                TDR test {IF_HOST[d]}
              </Pill>
            </div>
            {s.tdr[d] && <p className="mt-1 text-[11.5px] text-pv-text-muted">Last TDR on {IF_HOST[d]} ({spStamp(s.tdr[d]!.t).hms}): {s.tdr[d]!.open ? "pair 4-5 OPEN at 12 m" : "all four pairs normal"}.</p>}
          </Card>
        )}
        {tab === "optics" && sw && (
          <Card title={`${d} ge-0/0/47 · SFP-LX10 (1310 nm, single-mode)`}>
            <Kv k="Laser output power (Tx)" v={dbmText(d === "ACCESS-SW" ? v.uplink.txA : v.uplink.txD)} />
            <Kv k="Receiver power (Rx)" v={dbmText(d === "ACCESS-SW" ? v.uplink.rxA : v.uplink.rxD)} tone={rxBand(d === "ACCESS-SW" ? v.uplink.rxA : v.uplink.rxD) === "normal" ? undefined : "warn"} />
            <Kv k="Rx low warning / alarm thresholds" v="−14.00 dBm / −22.00 dBm" />
            <Kv k="Link" v={v.uplink.up ? "up" : `down — ${v.uplink.why}`} tone={v.uplink.up ? undefined : "warn"} />
          </Card>
        )}
        {tab === "main" && !sw && (
          <Card title={`${d} · eth0 · ${d === "CLIENT" ? L1_IP.CLIENT : L1_IP.SERVER}/24`}>
            <Kv k="Link detected" v={hl.up ? "yes" : "no"} tone={hl.up ? undefined : "warn"} />
            <Kv k="Speed / duplex" v={hl.up ? `${hl.speed} Mb/s ${hl.hostDuplex}` : "unknown"} tone={hl.mismatch || hl.downshift ? "warn" : undefined} />
            <Kv k="Auto-negotiation" v={s.host[host].autoneg ? "on" : `off (forced ${s.host[host].speed} Mb/s ${s.host[host].duplex})`} />
            <Kv k="rx_crc_errors · late collisions" v={`${s.hc[host].rxCrc} · ${s.hc[host].lateColl}`} tone={s.hc[host].rxCrc || s.hc[host].lateColl ? "warn" : undefined} />
            <Kv k="Carrier changes" v={String(s.hc[host].carrier)} />
            {!s.host[host].autoneg && (
              <div className="mt-1.5">
                <Pill onClick={() => c.act({ type: "host", dev: host, eth: { autoneg: true }, text: "ethtool -s eth0 autoneg on" })} disabled={c.busy}>
                  ethtool -s eth0 autoneg on
                </Pill>
              </div>
            )}
          </Card>
        )}
        {tab === "field" && <FieldKit c={c} d={d} />}
        {tab === "term" && <SpConsole c={c.cli} sets={l1Sets(api, d)} os={sw ? "junos" : "linux"} host={d} vendor="juniper" pipeCtx={sw ? l1Pipe(api, d) : undefined} />}
        {tab === "log" && (
          <ul className="space-y-0.5">
            {s.sys.filter((x) => x.dev === d).slice(-30).reverse().map((x, i) => (
              <li key={i} className="pv-mono text-[11.5px] text-pv-text-muted">
                {spStamp(x.t).hms} {x.text}
              </li>
            ))}
            {!s.sys.some((x) => x.dev === d) && <li className="text-[12px] text-pv-text-faint">No link events or commits yet.</li>}
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
  return (
    <div className="space-y-2 rounded-xl border border-pv-border p-2">
      <p className="text-[12px] font-semibold text-pv-text">
        CLIENT → SERVER {L1_IP.SERVER}
      </p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <Pill onClick={() => c.act({ type: "ping", count: 4 })} disabled={c.busy} tone="primary">
          ping ×4
        </Pill>
        <Pill onClick={() => c.act({ type: "ping", count: 100 })} disabled={c.busy}>
          ping ×100
        </Pill>
        <Pill onClick={() => c.act({ type: "iperf", reverse: true })} disabled={c.busy}>
          iperf3 download
        </Pill>
        <Pill onClick={() => c.act({ type: "iperf" })} disabled={c.busy}>
          iperf3 upload
        </Pill>
        <Pill onClick={() => c.act({ type: "snapshot" })} disabled={c.busy}>
          snapshot counters
        </Pill>
        <Pill onClick={() => c.act({ type: "wait", secs: WINDOW_S })} disabled={c.busy}>
          {WINDOW_S} s of traffic
        </Pill>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <span className="text-[11.5px] text-pv-text-faint">Field kit:</span>
        {BREAKS.map((b) => (
          <Pill key={b.id} onClick={() => c.act({ type: "break", id: b.id })} disabled={c.busy} tone="danger">
            {b.label}
          </Pill>
        ))}
      </div>
      <p className="text-[11.5px] text-pv-text-faint">Open a device for its interfaces, optics, field work and console.</p>
    </div>
  );
}

const SPEC: SpLabSpec<L1State, L1Action, unknown> = {
  title: "Layer 1 Lab",
  note: () => "link, optics, errors · Junos EX + Linux",
  fresh: (seq) => createL1Net(seq),
  vendors: ["juniper"],
  apply: l1Apply,
  snapOf: () => undefined,
  ticketAction: (id) => ({ type: "ticket", id: id as L1TicketId }),
  levels: L1_LEVELS,
  gate: {
    title: "You can read the physical layer",
    points: [
      "Admin state is intent, link state is achievement: up/down sends you to the cable or optics, admin down to the configuration.",
      "Each optic's Rx is the peer's Tx minus the strand: compare both ends to find the direction that loses light.",
      "Counters are history; a delta over a known interval with traffic is now.",
      "A link can stay up while it corrupts frames: marginal light → CRC errors on one side only.",
      "Speed and duplex must agree: forcing one end makes the other assume half duplex; a damaged pair downshifts gigabit to 100 Mb/s.",
    ],
    more: "The engineering workspace gives you every link's state and negotiation, both ends' optics, error counters with snapshots, ping and iperf3, a field kit for physical work, every device in its own window (Junos EX consoles on the switches, Linux shells on the hosts), five challenges and five tickets.",
  },
  stage,
  footer: (c) => {
    const t = lastTest(c.s);
    const v = l1View(c.s);
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
        <span>
          Last: <b className="text-pv-text">{t ? testText(t) : "none"}</b>
        </span>
        <span>
          ACCESS Rx {dbmText(v.uplink.rxA)} · uplink {v.uplink.up ? "up" : "down"}
        </span>
      </div>
    );
  },
  devices: ["CLIENT", "ACCESS-SW", "DIST-SW", "SERVER"],
  device: (id) => ({ label: id, icon: ROLE[id as L1D], tone: isSw(id as L1D) ? "#22d3ee" : "#34d399", sub: isSw(id as L1D) ? `${SUB[id as L1D]} · Junos` : `${SUB[id as L1D]} · Linux` }),
  openFrom: 1,
  window: (id, c) => <DeviceUI c={c} d={id as L1D} />,
  tools: [
    { id: "links", label: "Links", render: (c) => <LinksView c={c} /> },
    { id: "optics", label: "Optics", render: (c) => <OpticsView c={c} /> },
    { id: "counters", label: "Counters", render: (c) => <CountersView c={c} /> },
    { id: "path", label: "Last run, step by step", render: (c) => <PathView c={c} /> },
    { id: "log", label: "Log", render: (c) => <LogTool c={c} /> },
  ],
  toolsLabel: { learn: "What the physical layer shows", eng: "Tools" },
  evidence,
  composer: (c) => <Composer c={c} />,
  investigate: [
    "On ACCESS-SW: show interfaces terse, then show interfaces ge-0/0/47 extensive — how many CRC errors, and are they happening now?",
    "Snapshot, 30 s of traffic, snapshot: what is the uplink's CRC delta on each end?",
    "show interfaces diagnostics optics ge-0/0/47 on both switches: whose Rx matches whose Tx?",
    "On CLIENT: ethtool eth0 — then force ACCESS-SW ge-0/0/1 to 100m full-duplex with no-auto-negotiation. What does CLIENT conclude?",
    "Damage CLIENT's cable with the field kit, then run request diagnostics tdr start interface ge-0/0/1 on ACCESS-SW.",
  ],
  challenges: L1_CHALLENGES,
  tickets: L1_TICKETS.map((t) => ({ id: t.id, title: t.title, report: t.report, reproLabel: t.reproLabel, repro: t.repro })),
  ticketIntro: "Users describe a symptom; the physical layer holds the answer. Each ticket is this network after one real change. Reproduce it, read the link states, the light and the counter deltas, form a hypothesis, name the cause, fix it (configuration or field work) and prove it with fresh measurements.",
  reproHint: "Which links are up? Is the light normal at both ends? Are errors rising now — on which side?",
  fixHint: "Fix it on the device: Junos needs commit; physical problems need field work. Then measure again.",
  causes: L1_CAUSES,
  feedback: l1CauseFeedback,
  proofs: l1Proofs,
  ladder: (s) => l1Ladder(s),
  runCard: (c) => (
    <Card title="Result">
      <TestView c={c} />
    </Card>
  ),
};

export function L1LabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SpLabWorkspace spec={SPEC} open={open} onClose={onClose} />;
}
