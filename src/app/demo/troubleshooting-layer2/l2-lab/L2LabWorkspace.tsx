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
import { L2_IP, L2_MAC, MGMT } from "@/lib/sim-engine/scenarios/troubleshootingLayer2";
import {
  L2_CAUSES,
  L2_SWS,
  L2_TICKETS,
  SW_PORTS,
  VLAN_NAME,
  WIRES,
  createL2Net,
  l2Apply,
  l2CauseFeedback,
  l2Ladder,
  l2Proofs,
  l2Stp,
  lastTest,
  linkUp,
  liveFdb,
  loopVlans,
  peerOf,
  portCtr,
  portVlans,
  testText,
  type L2Action,
  type L2Cfg,
  type L2D,
  type L2H,
  type L2State,
  type L2Sw,
  type L2TicketId,
} from "@/lib/sim-engine/scenarios/l2Net";
import { l2Pipe, l2Sets, l2Validate, type L2CliApi } from "./l2Cli";
import { L2_LEVELS } from "./l2Learn";
import { L2_CHALLENGES } from "./l2Practice";

/**
 * Layer 2 Lab — the guided lesson's triangle: HOST-A on SW1, HOST-B on SW3, trunks between all three switches carrying
 * VLAN 10 (USERS) and VLAN 20 (MGMT). Live RSTP, 802.1Q tagging and classification on every port, MAC learning and
 * aging, loop and storm detection, and real consoles (Junos EX on the switches, Linux on the hosts).
 *   LEARN                  6 levels (l2Learn)
 *   ENGINEERING WORKSPACE  Investigate · Challenges (five) · Troubleshoot (five tickets)
 * One model (l2Net.ts) produces every reading.
 */

type Ctx = SpCtx<L2State, L2Action, unknown>;
const POS: Record<L2D, { x: number; y: number; cx: number; cy: number }> = {
  "HOST-A": { x: 9, y: 80, cx: 12, cy: 78 },
  SW1: { x: 27, y: 50, cx: 26, cy: 48 },
  SW2: { x: 50, y: 18, cx: 50, cy: 16 },
  SW3: { x: 73, y: 50, cx: 74, cy: 48 },
  "HOST-B": { x: 91, y: 80, cx: 88, cy: 78 },
};
const SUB: Record<L2D, string> = { "HOST-A": L2_IP["HOST-A"], SW1: "prio 32768", SW2: "root · prio 4096", SW3: "prio 8192", "HOST-B": L2_IP["HOST-B"] };
const ROLE: Record<L2D, string> = { "HOST-A": "host", SW1: "SW", SW2: "SW", SW3: "SW", "HOST-B": "host" };
const isSw = (d: L2D): d is L2Sw => d === "SW1" || d === "SW2" || d === "SW3";
const LABEL: Record<string, string> = { "L-A": "ge-0/0/1", "L-12": "ge-0/0/49", "L-13": "ge-0/0/50", "L-23": "ge-0/0/51", "L-B": "ge-0/0/1" };

function stage(c: Ctx, p: { moment?: SpMoment; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) {
  const s = c.s;
  const st = l2Stp(s);
  const lv = loopVlans(s.cfg, st);
  const nodes: SpStageNode[] = (Object.keys(POS) as L2D[]).map((d) => ({ id: d, label: d, role: ROLE[d], tone: isSw(d) ? "#22d3ee" : "#34d399", sub: isSw(d) ? (st.bridge[d].rstp ? `${st.bridge[d].rootSw === d ? "root · " : ""}prio ${s.cfg[d].prio}` : "no RSTP") : SUB[d], ...POS[d] }));
  const links: SpStageLink[] = WIRES.map((w) => {
    const blocked = SW_PORTS[w.a].includes(w.ap) && (st.ports[`${w.a}:${w.ap}`]?.state === "Discarding" || (isSw(w.b) && st.ports[`${w.b}:${w.bp}`]?.state === "Discarding"));
    const up = linkUp(s.cfg, w.id);
    const storm = lv.length > 0 && isSw(w.b) && up && !blocked;
    return { id: w.id, a: w.a, b: w.b, state: !up ? "down" : blocked ? "blocked" : storm ? "active" : "up", label: `${LABEL[w.id]}${blocked ? " · ALT" : ""}` };
  });
  const t = lastTest(s);
  const views: Record<string, TopoView> = {};
  if (!p.moment && t && t.cfgSeq === s.cfgSeq) views[t.from] = { badge: { text: t.unreachable ? "unreachable" : `${t.recv}/${t.sent}${t.storm ? " storm" : ""}`, tone: t.recv === t.sent ? "info" : "warn" } };
  if (!p.moment && lv.length) for (const sw of L2_SWS) views[sw] = { ...views[sw], ring: "bad" };
  return <SpStage nodes={nodes} links={links} views={views} moment={p.moment} momentKey={p.momentKey} compact={p.compact} onNode={p.onNode} selected={p.selected} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------------------------
type Cell = string | [string, "ok" | "bad" | "warn"];
function TestView({ c }: { c: Ctx }) {
  const t = lastTest(c.s);
  if (!t) return <p className="text-[12px] text-pv-text-faint">Run a test above.</p>;
  if (!c.done) return <p className="text-[12px] text-pv-text-faint">The result appears when the run has finished.</p>;
  const good = t.recv === t.sent && !t.storm;
  return (
    <div className={clsx("rounded-lg border px-2 py-1 text-[12.5px]", good ? "border-pv-success/40" : "border-pv-danger/40")}>
      <p className={clsx("font-semibold", good ? "text-pv-success" : "text-pv-danger")}>{testText(t)}</p>
      <p className="text-[11.5px] text-pv-text-muted">
        VLAN {t.vlan} ({VLAN_NAME[t.vlan]}) · started {spStamp(t.t0).hms}
      </p>
    </div>
  );
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
          {m.tokens.length > 0 && <p className="pv-mono text-[11px] text-pv-text-faint">{m.tokens.map((t) => `${t.from}→${t.to} ${t.label}`).join(" · ")}</p>}
        </li>
      ))}
    </ol>
  );
}
function FdbView({ c }: { c: Ctx }) {
  const s = c.s;
  const rows: Cell[][] = [];
  for (const sw of L2_SWS)
    for (const e of liveFdb(s, sw)) {
      const who = e.mac === L2_MAC["HOST-A"] ? "HOST-A" : e.mac === L2_MAC["HOST-B"] ? "HOST-B" : "switch";
      rows.push([sw, `${VLAN_NAME[e.vlan]} (${e.vlan})`, e.mac.toLowerCase(), who, e.vlan === 1 ? [`${e.port}`, "warn"] : e.port, `${Math.max(0, 300 - Math.floor(s.clock - e.seen))} s`]);
    }
  return (
    <div className="space-y-1">
      {rows.length ? <STable cols={["switch", "VLAN", "MAC", "host", "port", "ages out in"]} rows={rows} /> : <p className="text-[12px] text-pv-text-faint">No MAC addresses learned yet — send some traffic.</p>}
      <p className="text-[11px] text-pv-text-faint">A switch learns a frame&apos;s source MAC, in the VLAN it classified the frame into, on the port it arrived on. Entries age out after 300 s.</p>
    </div>
  );
}
function VlansView({ c }: { c: Ctx }) {
  const s = c.s;
  const rows: Cell[][] = [];
  for (const sw of L2_SWS)
    for (const port of SW_PORTS[sw]) {
      const pc = s.cfg[sw].ports[port];
      const peer = peerOf(sw, port)!;
      rows.push([`${sw} ${port}`, peer.dev.startsWith("SW") ? `${peer.dev} ${peer.port}` : peer.dev, portVlans(s.cfg[sw], port), pc?.disable ? ["disabled", "bad"] : linkUp(s.cfg, peer.link) ? "up" : ["down", "bad"]]);
    }
  return <STable cols={["port", "faces", "VLANs", "link"]} rows={rows} />;
}
function StpView({ c }: { c: Ctx }) {
  const s = c.s;
  const st = l2Stp(s);
  const rows: Cell[][] = [];
  for (const sw of L2_SWS)
    for (const port of SW_PORTS[sw]) {
      const ps = st.ports[`${sw}:${port}`];
      rows.push([`${sw} ${port}`, st.bridge[sw].rstp ? ps.role : ["no RSTP", "bad"], ps.state === "Discarding" ? ["Discarding", "warn"] : "Forwarding", ps.bpdus ? "yes" : "no"]);
    }
  const lv = loopVlans(s.cfg, st);
  return (
    <div className="space-y-1">
      <STable cols={["port", "role", "state", "BPDUs received"]} rows={rows} />
      <p className={clsx("text-[11.5px]", lv.length ? "text-pv-danger" : "text-pv-text-faint")}>
        {lv.length ? `Forwarding loop in VLAN ${lv.join(" and ")} — broadcast storm.` : `Root: ${st.bridge.SW1.rootSw ?? "—"} · cost 20000 per link · exactly one Alternate port breaks the triangle.`}
      </p>
    </div>
  );
}
function CountersView({ c }: { c: Ctx }) {
  const s = c.s;
  const rows: Cell[][] = [];
  for (const sw of L2_SWS)
    for (const port of SW_PORTS[sw]) {
      const x = portCtr(s, `${sw}:${port}`);
      rows.push([`${sw} ${port}`, String(x.inPkts), x.bcastIn > 100_000 ? [String(x.bcastIn), "bad"] : String(x.bcastIn), x.drops ? [String(x.drops), "warn"] : "0"]);
    }
  return (
    <div className="space-y-1">
      <STable cols={["port", "in packets", "broadcasts in", "input drops"]} rows={rows} />
      <p className="text-[11px] text-pv-text-faint">Since the last clear. A storm shows as broadcasts climbing by hundreds of thousands per second; input drops count frames refused on arrival (wrong tag, VLAN not allowed).</p>
    </div>
  );
}
function Ladder({ c }: { c: Ctx }) {
  if (c.busy) return <p className="text-[12px] text-pv-text-faint">The ladder fills in when the run has finished.</p>;
  return (
    <ol className="space-y-1">
      {l2Ladder(c.s).map((r, i) => (
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
    case "path":
      return card("Where the frames went", <PathView c={c} />);
    case "fdb":
      return card("MAC tables (all three switches)", <FdbView c={c} />);
    case "vlans":
      return card("Every switch port: mode and VLANs", <VlansView c={c} />);
    case "stp":
      return card("Spanning tree", <StpView c={c} />);
    case "counters":
      return card("Port counters", <CountersView c={c} />);
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
function cfgDiff(r: L2Sw, a: L2Cfg, b: L2Cfg): string {
  const out: string[] = [];
  for (const port of SW_PORTS[r]) if (portVlans(a, port) !== portVlans(b, port) || !!a.ports[port]?.disable !== !!b.ports[port]?.disable) out.push(`${port}: ${b.ports[port]?.disable ? "disabled, " : ""}${portVlans(b, port)}`);
  if (a.rstp !== b.rstp) out.push(b.rstp ? "RSTP enabled" : "RSTP removed");
  if (a.prio !== b.prio) out.push(`bridge-priority ${b.prio}`);
  if (a.vlans.join() !== b.vlans.join()) out.push(`VLANs ${b.vlans.map((v) => VLAN_NAME[v]).join(", ")}`);
  return out.join("; ") || "no change";
}
function devCli(c: Ctx, r: L2Sw): SpDevCli<L2Cfg> {
  return {
    host: r,
    running: c.s.cfg[r],
    hist: c.s.hist[r],
    cand: c.cli.cand[r] as L2Cfg | undefined,
    setCand: (x) => c.cli.setCand(r, x),
    xr: c.cli.xr[r] ?? [],
    setXr: (st) => c.cli.setXr(r, st),
    edit: !!c.cli.edit[r],
    setEdit: (b) => c.cli.setEdit(r, b),
    commit: (cfg, how) => c.act({ type: "cfg", dev: r, cfg, text: `${cfgDiff(r, c.s.cfg[r], cfg)} (${how}, Junos)` }),
    ask: c.cli.setQuestion,
    validate: l2Validate,
  };
}
const hostApi = (c: Ctx, d: L2D): L2CliApi => ({ s: c.s, act: c.act, dev: { host: d, running: { ports: {}, rstp: false, prio: 0, vlans: [] }, hist: [], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } });
type Tab = "main" | "mac" | "stp" | "term" | "log";
function DeviceUI({ c, d }: { c: Ctx; d: L2D }) {
  const [tab, setTab] = useState<Tab>("main");
  const s = c.s;
  const sw = isSw(d);
  const api: L2CliApi = sw ? { s, act: c.act, dev: devCli(c, d) } : hostApi(c, d);
  const st = l2Stp(s);
  const tabs: [Tab, string][] = sw ? [["main", "Ports"], ["mac", "MAC table"], ["stp", "Spanning tree"], ["term", "Console"], ["log", "Log"]] : [["main", "Host"], ["term", "Console"]];
  return (
    <div>
      <Tabs tabs={tabs} cur={tab} set={setTab} />
      <div className="space-y-2 p-3">
        {tab === "main" && sw && (
          <Card title={`${d} · ports · irb.20 ${MGMT[d].ip}/24`}>
            <STable
              cols={["port", "faces", "VLANs", "STP", "link"]}
              rows={SW_PORTS[d].map((port) => {
                const peer = peerOf(d, port)!;
                const ps = st.ports[`${d}:${port}`];
                return [port, peer.dev.startsWith("SW") ? `${peer.dev} ${peer.port}` : peer.dev, portVlans(s.cfg[d], port), st.bridge[d].rstp ? (ps.state === "Discarding" ? [`${ps.role} · Discarding`, "warn"] : `${ps.role} · Forwarding`) : ["no RSTP", "bad"], linkUp(s.cfg, peer.link) ? "up" : ["down", "bad"]] as Cell[];
              })}
            />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Pill onClick={() => c.act({ type: "clear-mac", dev: d })} disabled={c.busy}>
                clear ethernet-switching table
              </Pill>
              <Pill onClick={() => c.act({ type: "clear-stats", dev: d })} disabled={c.busy}>
                clear interfaces statistics all
              </Pill>
            </div>
          </Card>
        )}
        {tab === "mac" && sw && (
          <Card title={`${d} · MAC table`}>
            {liveFdb(s, d).length ? <STable cols={["VLAN", "MAC", "port", "ages out in"]} rows={liveFdb(s, d).map((e) => [`${VLAN_NAME[e.vlan]} (${e.vlan})`, e.mac.toLowerCase(), e.port, `${Math.max(0, 300 - Math.floor(s.clock - e.seen))} s`])} /> : <p className="text-[12px] text-pv-text-faint">Empty — nothing learned (or aged out).</p>}
          </Card>
        )}
        {tab === "stp" && sw && (
          <Card title={`${d} · RSTP`}>
            {st.bridge[d].rstp ? (
              <>
                <Kv k="Bridge ID" v={`${s.cfg[d].prio}.${MGMT[d].mac.toLowerCase()}`} />
                <Kv k="Root" v={st.bridge[d].rootSw === d ? "this bridge" : `${st.bridge[d].rootSw} (${st.bridge[d].rootId})`} />
                <Kv k="Root cost / port" v={st.bridge[d].rootSw === d ? "0 / —" : `${st.bridge[d].cost} / ${st.bridge[d].rootPort}`} />
              </>
            ) : (
              <p className="text-[12px] text-pv-danger">No protocols rstp on this switch: no BPDUs sent or processed, every port forwards.</p>
            )}
          </Card>
        )}
        {tab === "main" && !sw && (
          <Card title={`${d} · ${L2_IP[d as L2H]}/24 · ${L2_MAC[d as L2H].toLowerCase()}`}>
            <Kv k="Switch port" v={d === "HOST-A" ? `SW1 ge-0/0/1 (${portVlans(s.cfg.SW1, "ge-0/0/1")})` : `SW3 ge-0/0/1 (${portVlans(s.cfg.SW3, "ge-0/0/1")})`} />
            {Object.entries(s.arp[d]).map(([ip, e]) => (
              <Kv key={ip} k={`ARP ${ip}`} v={e.state === "FAILED" ? "FAILED" : `${e.mac.toLowerCase()} REACHABLE`} tone={e.state === "FAILED" ? "warn" : undefined} />
            ))}
          </Card>
        )}
        {tab === "term" && <SpConsole c={c.cli} sets={l2Sets(api, d)} os={sw ? "junos" : "linux"} host={d} vendor="juniper" pipeCtx={sw ? l2Pipe(api, d) : undefined} />}
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
  const p = (from: L2D, to: string, count = 4): L2Action => ({ type: "ping", from, to, count });
  return (
    <div className="space-y-2 rounded-xl border border-pv-border p-2">
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <Pill onClick={() => c.act(p("HOST-A", L2_IP["HOST-B"]))} disabled={c.busy} tone="primary">
          HOST-A → HOST-B
        </Pill>
        <Pill onClick={() => c.act(p("HOST-B", L2_IP["HOST-A"]))} disabled={c.busy}>
          HOST-B → HOST-A
        </Pill>
        <Pill onClick={() => c.act(p("SW1", MGMT.SW3.ip))} disabled={c.busy}>
          SW1 → SW3 (VLAN 20)
        </Pill>
        <Pill onClick={() => c.act(p("SW1", MGMT.SW2.ip))} disabled={c.busy}>
          SW1 → SW2 (VLAN 20)
        </Pill>
        <Pill onClick={() => c.act({ type: "wait", secs: 60 })} disabled={c.busy}>
          wait 60 s
        </Pill>
      </div>
      <p className="text-[11.5px] text-pv-text-faint">HOST-A and HOST-B are in VLAN 10; the switches&apos; management addresses are in VLAN 20. Open a switch for its ports, MAC table, spanning tree and console.</p>
    </div>
  );
}

const SPEC: SpLabSpec<L2State, L2Action, unknown> = {
  title: "Layer 2 Lab",
  note: () => "VLANs, MACs, RSTP · Junos EX + Linux",
  fresh: (seq) => createL2Net(seq),
  vendors: ["juniper"],
  apply: l2Apply,
  snapOf: () => undefined,
  ticketAction: (id) => ({ type: "ticket", id: id as L2TicketId }),
  levels: L2_LEVELS,
  gate: {
    title: "You can follow a frame through switches",
    points: [
      "Switches learn source MACs per VLAN on the ingress port, flood the unknown, forward the known.",
      "Access ports carry one VLAN untagged; trunks carry their member VLANs tagged and one native VLAN untagged.",
      "A VLAN missing from one trunk stops silently — links up, other VLANs fine.",
      "Both ends of a trunk must agree on mode and native VLAN.",
      "RSTP blocks exactly one port of a loop; without it, broadcasts storm.",
    ],
    more: "The engineering workspace gives you every port's VLANs and STP role, the MAC tables of all three switches, port counters, pings in VLAN 10 and VLAN 20, every device in its own window (Junos EX consoles on the switches, Linux shells on the hosts), five challenges and five tickets.",
  },
  stage,
  footer: (c) => {
    const t = lastTest(c.s);
    const st = l2Stp(c.s);
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
        <span>
          Last: <b className="text-pv-text">{t ? testText(t) : "none"}</b>
        </span>
        <span>
          root {st.bridge.SW1.rootSw ?? "—"} · Alternate {Object.entries(st.ports).filter(([, x]) => x.role === "Alternate").map(([k]) => k.replace(":", " ")).join(", ") || "none"}
        </span>
      </div>
    );
  },
  devices: ["HOST-A", "SW1", "SW2", "SW3", "HOST-B"],
  device: (id) => ({ label: id, icon: ROLE[id as L2D], tone: isSw(id as L2D) ? "#22d3ee" : "#34d399", sub: isSw(id as L2D) ? `${MGMT[id as L2Sw].ip} · Junos` : `${L2_IP[id as L2H]} · Linux` }),
  openFrom: 1,
  window: (id, c) => <DeviceUI c={c} d={id as L2D} />,
  tools: [
    { id: "path", label: "Where the frames went", render: (c) => <PathView c={c} /> },
    { id: "fdb", label: "MAC tables", render: (c) => <FdbView c={c} /> },
    { id: "vlans", label: "Port VLANs", render: (c) => <VlansView c={c} /> },
    { id: "stp", label: "Spanning tree", render: (c) => <StpView c={c} /> },
    { id: "counters", label: "Counters", render: (c) => <CountersView c={c} /> },
    { id: "log", label: "Log", render: (c) => <LogTool c={c} /> },
  ],
  toolsLabel: { learn: "What the switches show", eng: "Tools" },
  evidence,
  composer: (c) => <Composer c={c} />,
  investigate: [
    "Ping HOST-A → HOST-B, then read all three MAC tables: on which port did each switch learn each host?",
    "On SW2: show ethernet-switching interface ge-0/0/51 — which VLANs are tagged, which untagged?",
    "On SW1: show spanning-tree interface — why is ge-0/0/50 BLK? Then lower SW3's bridge-priority and look again.",
    "Remove USERS from one trunk: which pings fail, which still work?",
    "Delete protocols rstp on SW1 (then put it back): what do the counters and logs do?",
  ],
  challenges: L2_CHALLENGES,
  tickets: L2_TICKETS.map((t) => ({ id: t.id, title: t.title, report: t.report, reproLabel: t.reproLabel, repro: t.repro })),
  ticketIntro: "Users describe a symptom; the switches' tables hold the answer. Each ticket is this network after one configuration change. Reproduce it, follow the frame, read the MAC tables, the port VLANs and spanning tree, name the cause, fix it in Junos and prove it with fresh traffic.",
  reproHint: "Which VLAN fails, which still works? Where did the frame stop? Which switch learned which MAC, in which VLAN, on which port?",
  fixHint: "Fix it in the switch's console (configure … commit), then run the same test again.",
  causes: L2_CAUSES,
  feedback: l2CauseFeedback,
  proofs: l2Proofs,
  ladder: (s) => l2Ladder(s),
  runCard: (c) => (
    <Card title="Result">
      <TestView c={c} />
    </Card>
  ),
};

export function L2LabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <SpLabWorkspace spec={SPEC} open={open} onClose={onClose} />;
}
