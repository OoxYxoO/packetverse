"use client";

import { clsx } from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CliVendor } from "@/lib/cli/types";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { ConsoleTerminal, EMPTY_SESSION, type ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import { BCAST, HOST_IP, HOST_MAC, HOST_PORT, HOST_SW, SPARE, ST_PORTS, bidName, bidOf, isSw, pk, stClone, stFrameName, stMacName, stPeer, stPortRole, stPortState, stPortStatus, stShortMac, stTable, type StAction, type StCap, type StDev, type StHost, type StPort, type StPortCfg, type StProto, type StSnap, type StState, type StSw } from "@/lib/sim-engine/scenarios/stpNet";
import { stHostSet, stJunosConfig, stSwitchSets, type StCand, type StCliApi, type StIosMode } from "./stCli";
import { stPortName } from "./stNames";
import { ROLE_BADGE } from "./StTopology";

/**
 * STP Lab devices (drag, minimize to a tray; full screen on phones).
 *   SW1–SW3  Spanning tree (this bridge's ID and what it believes about the root; every port's role, state, timers and
 *            cost — change priority, mode, costs, edge, BPDU guard, root guard, or take a port out of spanning tree)
 *            · MAC table · Cisco/Junos console · capture on any port (BPDUs and data) · log
 *   Hosts    the cable (unplug, plug, reseat) · send · shell · capture
 * Every value is read from the lab state; every change goes through the model.
 */

export interface StDeskCtx {
  view: StState;
  snap?: StSnap;
  act: (a: StAction) => StState;
  vendor: CliVendor;
  setVendor: (v: CliVendor) => void;
  ios: Record<StSw, StIosMode>;
  setIos: (d: StSw, m: StIosMode) => void;
  junosEdit: Record<StSw, boolean>;
  setJunosEdit: (d: StSw, b: boolean) => void;
  cand: StCand;
  setCand: (c: StCand) => void;
  consoles: Record<string, ConsoleSession>;
  setConsoles: (u: (m: Record<string, ConsoleSession>) => Record<string, ConsoleSession>) => void;
  notes: boolean;
  setNotes: (b: boolean) => void;
  question?: CliQuestion;
  setQuestion: (q: CliQuestion | undefined) => void;
}
export interface StWin {
  id: StDev;
  minimized: boolean;
  x: number;
  y: number;
  z: number;
}
function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 639px)");
    const f = () => setNarrow(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return narrow;
}
function Tabs<T extends string>({ tabs, cur, set }: { tabs: [T, string][]; cur: T; set: (t: T) => void }) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 border-b border-pv-border px-3 py-1.5">
      {tabs.map(([t, label]) => (
        <button key={t} type="button" role="tab" aria-selected={cur === t} onClick={() => set(t)} className={clsx("rounded-md px-2.5 py-1 text-[12.5px] font-semibold", cur === t ? "bg-pv-cyan/15 text-pv-text" : "text-pv-text-muted hover:text-pv-text")}>
          {label}
        </button>
      ))}
    </div>
  );
}
export const Kv = ({ k, v, tone }: { k: string; v: ReactNode; tone?: "warn" | "bad" | "ok" }) => (
  <div className="flex justify-between gap-3 border-b border-pv-border/50 py-1 text-[12.5px]">
    <span className="text-pv-text-muted">{k}</span>
    <span className={clsx("pv-mono text-right", tone === "bad" ? "text-pv-danger" : tone === "warn" ? "text-pv-warning" : tone === "ok" ? "text-pv-success" : "text-pv-text")}>{v}</span>
  </div>
);
const btn = "rounded-full border border-pv-border px-2.5 py-0.5 text-[12px] font-semibold text-pv-text-muted hover:border-pv-cyan/60 hover:text-pv-text disabled:opacity-40";
const sel = "rounded-md border border-pv-border bg-pv-bg px-1 py-0.5 text-[12px] text-pv-text";
const BADGE = { ok: "bg-pv-success/15 text-pv-success", warn: "bg-pv-warning/20 text-pv-warning", bad: "bg-pv-danger/20 text-pv-danger", muted: "bg-black/40 text-pv-text-faint" } as const;
export const RoleBadge = ({ s, sw, p }: { s: StState; sw: StSw; p: string }) => {
  const b = ROLE_BADGE(s, sw, p);
  return <span className={clsx("pv-mono rounded px-1 text-[11px] font-bold", BADGE[b.tone])}>{b.text}</span>;
};

// ---------------------------------------------------------------------------------------------------------------
// Captures
// ---------------------------------------------------------------------------------------------------------------
export const capPoints = (s: StState): string[] => [...(["SW1", "SW2", "SW3"] as StSw[]).flatMap((sw) => ST_PORTS.filter((p) => stPeer(s.cfg, sw, p)).map((p) => pk(sw, p))), ...(["HOST-A", "HOST-B", "HOST-C"] as StHost[]).filter((h) => s.cfg.hosts[h])];
export const capLabel = (vendor: CliVendor, p: string) => (p.includes(" ") ? `${p.split(" ")[0]} ${stPortName(vendor, p.split(" ")[1])}` : p);
export function CaptureView({ s, points, initial, vendor }: { s: StState; points: string[]; initial?: string; vendor: CliVendor }) {
  const [point, setPoint] = useState<string>(initial && points.includes(initial) ? initial : points[0]);
  const [onlyLast, setOnlyLast] = useState(true);
  const [kind, setKind] = useState<"all" | "bpdu" | "data">("all");
  const [pick, setPick] = useState<StCap | undefined>(undefined);
  const rows = s.captures.filter((c) => c.point === point && (!onlyLast || !s.last || c.run === s.last.id) && (kind === "all" || (kind === "bpdu") === (c.frame.kind === "bpdu"))).slice(-120);
  const role = (p: string) => (p.includes(" ") ? stPortRole(s.cfg, p.split(" ")[0] as StSw, p.split(" ")[1]) : "NIC");
  return (
    <div className="space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-pv-text-muted">
        {points.length > 1 && (
          <select value={point} onChange={(e) => (setPoint(e.target.value), setPick(undefined))} className="rounded-md border border-pv-border bg-pv-bg px-2 py-0.5 text-[12px] text-pv-text" aria-label="Capture point">
            {points.map((p) => (
              <option key={p} value={p}>
                {capLabel(vendor, p)} — {role(p)}
              </option>
            ))}
          </select>
        )}
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={sel} aria-label="Show">
          <option value="all">all frames</option>
          <option value="bpdu">BPDUs only</option>
          <option value="data">data only</option>
        </select>
        <label className="ml-auto flex items-center gap-1">
          <input type="checkbox" checked={onlyLast} onChange={(e) => setOnlyLast(e.target.checked)} /> last run only
        </label>
      </div>
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-pv-text-faint">Nothing crossed {capLabel(vendor, point)}{onlyLast ? " during the last run" : ""}. (BPDUs appear when you send a Hello; data when hosts send.)</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[540px] text-left text-[12px]">
            <thead className="text-[11px] text-pv-text-faint">
              <tr>
                <th className="px-1.5 py-1">#</th>
                <th className="px-1.5 py-1">hop</th>
                <th className="px-1.5 py-1">dir</th>
                <th className="px-1.5 py-1">src → dst MAC</th>
                <th className="px-1.5 py-1">what</th>
                <th className="px-1.5 py-1">copies</th>
              </tr>
            </thead>
            <tbody className="pv-mono">
              {rows.map((c) => (
                <tr key={c.n} onClick={() => setPick(c)} className={clsx("cursor-pointer border-t border-pv-border/50 hover:bg-white/[0.03]", pick?.n === c.n && "bg-pv-cyan/10", c.count > 1 && "text-pv-warning", c.frame.kind === "bpdu" && "text-pv-violet")}>
                  <td className="px-1.5 py-0.5">{c.n}</td>
                  <td className="px-1.5 py-0.5">{c.wave + 1}</td>
                  <td className="px-1.5 py-0.5">{c.dir}</td>
                  <td className="px-1.5 py-0.5">
                    {stShortMac(c.frame.src)} ({stMacName(c.frame.src).replace("HOST-", "")}) → {c.frame.dst === BCAST ? "broadcast" : stShortMac(c.frame.dst)}
                  </td>
                  <td className="px-1.5 py-0.5 font-sans">{stFrameName(c.frame)}</td>
                  <td className="px-1.5 py-0.5">{c.count > 1 ? `×${c.count.toLocaleString("en-US")}` : "1"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pick && (
        <div className="rounded-xl border border-pv-border bg-pv-bg/60 p-2.5 text-[12.5px]">
          <p className="font-semibold text-pv-text">
            #{pick.n} on {capLabel(vendor, pick.point)} ({pick.dir === "in" ? "received" : "sent"}) · hop {pick.wave + 1}
          </p>
          <div className="mt-1 grid gap-x-4 sm:grid-cols-2">
            <Kv k="Destination MAC" v={pick.frame.dst} />
            <Kv k="Source MAC" v={pick.frame.src} />
            {pick.frame.kind === "bpdu" ? (
              <>
                <Kv k="Frame" v="802.3 + LLC 0x42/0x42/0x03 (not IP)" />
                <Kv k="Protocol version" v={pick.frame.bpdu!.proto === "rstp" ? "2 (RSTP)" : "0 (STP)"} />
                <Kv k="Root ID" v={`${pick.frame.bpdu!.root.priority} / ${pick.frame.bpdu!.root.mac} (${bidName(pick.frame.bpdu!.root)})`} tone="ok" />
                <Kv k="Root path cost" v={pick.frame.bpdu!.cost} tone="ok" />
                <Kv k="Bridge ID (sender)" v={`${pick.frame.bpdu!.bridge.priority} / ${pick.frame.bpdu!.bridge.mac}`} />
                <Kv k="Port ID" v={`128.${pick.frame.bpdu!.port.split("/").pop()}`} />
                <Kv k="Flags" v={pick.frame.bpdu!.tc ? "Topology Change" : "—"} tone={pick.frame.bpdu!.tc ? "warn" : undefined} />
              </>
            ) : (
              <>
                <Kv k="EtherType" v={pick.frame.kind.startsWith("arp") ? "0x0806 (ARP)" : "0x0800 (IPv4)"} />
                <Kv k="Carries" v={stFrameName(pick.frame)} />
                <Kv k="Hop count / TTL in the Ethernet header" v="none — Ethernet has no such field" tone="warn" />
              </>
            )}
          </div>
          {pick.count > 1 && <p className="mt-1.5 text-[12px] text-pv-warning">{pick.count.toLocaleString("en-US")} identical copies crossed this point in the same hop: a loop.</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------------------------------------------
function cliApi(c: StDeskCtx, key: string): StCliApi {
  return { view: c.view, act: c.act, ios: c.ios, setIos: c.setIos, junosEdit: c.junosEdit, setJunosEdit: c.setJunosEdit, cand: c.cand, setCand: c.setCand, ask: c.setQuestion, history: c.consoles[key]?.history ?? [] };
}
export function DevConsole({ c, dev, className }: { c: StDeskCtx; dev: StSw | StHost; className?: string }) {
  const host = !isSw(dev);
  const os = host ? "linux" : c.vendor === "cisco" ? "ios" : "junos";
  const key = `${dev}:${os}`;
  const api = cliApi(c, key);
  const sets = host ? { cisco: stHostSet(api, dev as StHost), juniper: stHostSet(api, dev as StHost) } : stSwitchSets(api, dev as StSw);
  return (
    <ConsoleTerminal
      key={key}
      sets={sets}
      vendor={c.vendor}
      setVendor={host ? undefined : c.setVendor}
      os={os}
      host={dev}
      session={c.consoles[key] ?? EMPTY_SESSION}
      setSession={(u) => c.setConsoles((m) => ({ ...m, [key]: u(m[key] ?? EMPTY_SESSION) }))}
      notes={c.notes}
      setNotes={c.setNotes}
      question={c.question?.node === dev ? c.question : undefined}
      pipeCtx={host ? undefined : { config: stJunosConfig(api, dev as StSw), rollbacks: 1 }}
      className={className ?? "h-[min(440px,58vh)]"}
    />
  );
}

function SwitchUI({ c, sw }: { c: StDeskCtx; sw: StSw }) {
  const [tab, setTab] = useState<"stp" | "mac" | "term" | "cap" | "log">("stp");
  const s = c.view;
  const cfg = s.cfg;
  const sc = cfg.sw[sw];
  const b = s.tree.bridges[sw];
  const set = (patch: Partial<typeof sc>, text: string) => {
    const n = stClone(cfg);
    n.sw[sw] = { ...n.sw[sw], ...patch };
    c.act({ type: "cfg", cfg: n, text: `${sw}: ${text}` });
  };
  const setPort = (p: StPort, patch: Partial<StPortCfg>, text: string) => set({ ports: { ...sc.ports, [p]: { ...sc.ports[p], ...patch } } }, `${p} ${text}`);
  const logs = s.syslog.filter((l) => l.sw === sw);
  return (
    <>
      <Tabs
        tabs={[
          ["stp", "Spanning tree"],
          ["mac", "MAC table"],
          ["term", "Console"],
          ["cap", "Capture"],
          ["log", "Log"],
        ]}
        cur={tab}
        set={setTab}
      />
      {tab === "stp" && (
        <div className="space-y-2 p-3">
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Kv k="Bridge ID (priority / MAC)" v={`${sc.priority} / ${bidOf(cfg, sw).mac}`} />
            <Kv k="Protocol" v={sc.proto === "rstp" ? "RSTP (802.1w)" : sc.proto === "stp" ? "legacy STP (802.1D)" : "none — spanning tree off!"} tone={sc.proto === "rstp" ? undefined : "bad"} />
            <Kv k="Root bridge (as this switch believes)" v={b ? `${b.root}${b.root === sw ? " (itself)" : ""} · ${bidOf(cfg, b.root).priority}` : "—"} tone={b && b.root !== "SW1" ? "warn" : undefined} />
            <Kv k="Root path cost · Root Port" v={b ? (b.root === sw ? "0 · none (it is root)" : `${b.cost} · ${stPortName(c.vendor, b.rootPort!)}`) : "—"} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-pv-text-muted">
            <label className="flex items-center gap-1">
              priority
              <select aria-label={`${sw} priority`} className={sel} value={sc.priority} onChange={(e) => set({ priority: +e.target.value }, `bridge priority ${e.target.value}`)}>
                {Array.from({ length: 16 }, (_, i) => i * 4096).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              protocol
              <select aria-label={`${sw} protocol`} className={sel} value={sc.proto} onChange={(e) => set({ proto: e.target.value as StProto }, `spanning tree: ${e.target.value}`)}>
                <option value="rstp">RSTP</option>
                <option value="stp">legacy STP</option>
                <option value="none">off</option>
              </select>
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-[12px]">
              <thead className="text-[11px] text-pv-text-faint">
                <tr>
                  <th className="px-1.5 py-1">port</th>
                  <th className="px-1.5 py-1">leads to</th>
                  <th className="px-1.5 py-1">role · state</th>
                  <th className="px-1.5 py-1">cost</th>
                  <th className="px-1.5 py-1">edge · BPDU guard · root guard · in STP</th>
                  <th className="px-1.5 py-1" />
                </tr>
              </thead>
              <tbody>
                {ST_PORTS.map((p) => {
                  const pc = sc.ports[p];
                  const st = stPortState(s, sw, p);
                  const status = stPortStatus(cfg, s.errdis, sw, p);
                  const chk = (k: "edge" | "bpduGuard" | "rootGuard", label: string) => (
                    <label className="mr-2 inline-flex items-center gap-0.5">
                      <input type="checkbox" checked={pc[k]} onChange={(e) => setPort(p, { [k]: e.target.checked }, `${label} ${e.target.checked ? "on" : "off"}`)} aria-label={`${sw} ${p} ${label}`} />
                      {label}
                    </label>
                  );
                  return (
                    <tr key={p} className="border-t border-pv-border/50 align-top">
                      <td className="pv-mono whitespace-nowrap px-1.5 py-1 text-pv-text">{stPortName(c.vendor, p)}</td>
                      <td className="px-1.5 py-1 text-pv-text-muted">{stPortRole(cfg, sw, p)}</td>
                      <td className="px-1.5 py-1">
                        <RoleBadge s={s} sw={sw} p={p} />
                        {st.wait > 0 && <span className="ml-1 text-[11px] text-pv-warning">{st.wait} s to FWD</span>}
                        {status !== "connected" && <span className={clsx("ml-1 text-[11px]", status === "err-disabled" ? "text-pv-danger" : "text-pv-text-faint")}>{status}</span>}
                      </td>
                      <td className="px-1.5 py-1">
                        <select aria-label={`${sw} ${p} cost`} className={sel} value={pc.cost} onChange={(e) => setPort(p, { cost: +e.target.value }, `cost ${e.target.value}`)}>
                          {[...new Set([2000, 20000, 200000, pc.cost])].map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1.5 py-1 text-[11.5px] text-pv-text-muted">
                        {chk("edge", "edge")}
                        {chk("bpduGuard", "BPDU guard")}
                        {chk("rootGuard", "root guard")}
                        <label className="inline-flex items-center gap-0.5">
                          <input type="checkbox" checked={!pc.stpOff} onChange={(e) => setPort(p, { stpOff: !e.target.checked }, e.target.checked ? "back in spanning tree" : "taken out of spanning tree")} aria-label={`${sw} ${p} in spanning tree`} />
                          in STP
                        </label>
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-1 text-right">
                        <button type="button" className={btn} onClick={() => setPort(p, { shut: !pc.shut }, pc.shut ? "enabled" : "disabled")}>
                          {pc.shut ? "Enable" : "Disable"}
                        </button>
                        {s.errdis.includes(pk(sw, p)) && (
                          <button type="button" className={clsx(btn, "ml-1")} onClick={() => c.act({ type: "clear-errdis", sw, port: p })}>
                            Recover
                          </button>
                        )}
                        {sw === "SW3" && p === SPARE && (
                          <button type="button" className={clsx(btn, "ml-1")} onClick={() => c.act({ type: "rogue", up: !cfg.rogue })}>
                            {cfg.rogue ? "Unplug the small switch" : "Plug in a small switch"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11.5px] text-pv-text-faint">RP root port · DP designated · ALT alternate (Discarding) · EDGE edge port · BKN err-disabled / root-inconsistent · OFF out of spanning tree. ·LRN / ·BLK / ·LIS: not forwarding yet (timers).</p>
        </div>
      )}
      {tab === "mac" && (
        <div className="space-y-2 p-3">
          {stTable((c.snap ?? s).fdb, sw).length === 0 ? (
            <p className="text-[12.5px] text-pv-text-faint">Empty.</p>
          ) : (
            <table className="w-full text-left text-[12px]">
              <tbody className="pv-mono">
                {stTable((c.snap ?? s).fdb, sw).map((e) => (
                  <tr key={e.mac} className="border-t border-pv-border/50">
                    <td className="px-1.5 py-0.5">{e.mac}</td>
                    <td className="px-1.5 py-0.5 font-semibold text-pv-text">{stMacName(e.mac)}</td>
                    <td className="px-1.5 py-0.5">{stPortName(c.vendor, e.port)}</td>
                    <td className="px-1.5 py-0.5 font-sans text-pv-text-muted">{stPortRole(cfg, sw, e.port)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-[11.5px] text-pv-text-muted">A topology change flushes the entries learned on non-edge ports on every switch: frames are flooded until the tables refill.</p>
          <button type="button" className={btn} onClick={() => c.act({ type: "clear", sw })}>
            Clear {sw}&apos;s learned entries
          </button>
        </div>
      )}
      {tab === "term" && <DevConsole c={c} dev={sw} />}
      {tab === "cap" && <CaptureView s={s} points={ST_PORTS.filter((p) => stPeer(cfg, sw, p)).map((p) => pk(sw, p))} vendor={c.vendor} />}
      {tab === "log" && (
        <div className="space-y-1 p-3 text-[12.5px]">
          {logs.length === 0 ? (
            <p className="text-pv-text-faint">No events.</p>
          ) : (
            logs.slice(-40).map((l, i) => (
              <p key={i} className={clsx("pv-mono text-[12px]", ["errdis", "flap", "rootinc", "newroot"].includes(l.ev) ? "text-pv-danger" : l.ev === "tc" || l.ev === "role" ? "text-pv-warning" : "text-pv-text-muted")}>
                t={l.clock}s ·{" "}
                {l.ev === "flap" ? `${stMacName(l.mac!)} moved ${stPortName(c.vendor, l.ports![0])} → ${stPortName(c.vendor, l.ports![1])}` : l.ev === "tc" ? "topology change: MAC entries on non-edge ports flushed" : l.ev === "newroot" ? `new root bridge: ${l.text}` : l.ev === "role" ? `${stPortName(c.vendor, l.port!)} ${l.text}` : l.ev === "errdis" ? `${stPortName(c.vendor, l.port!)} err-disabled (BPDU guard)` : l.ev === "rootinc" ? `${stPortName(c.vendor, l.port!)} root-inconsistent (root guard)` : l.ev === "rootinc-clear" ? `${stPortName(c.vendor, l.port!)} root guard released` : `${stPortName(c.vendor, l.port!)} ${l.ev === "admin-down" ? "administratively down" : l.ev}`}
              </p>
            ))
          )}
        </div>
      )}
    </>
  );
}

function HostUI({ c, h }: { c: StDeskCtx; h: StHost }) {
  const [tab, setTab] = useState<"nic" | "send" | "shell" | "cap">("nic");
  const s = c.view;
  const up = s.cfg.hosts[h];
  const sw = HOST_SW[h];
  const st = stPortState(s, sw, HOST_PORT);
  const others = (["HOST-A", "HOST-B", "HOST-C"] as StHost[]).filter((x) => x !== h);
  return (
    <>
      <Tabs
        tabs={[
          ["nic", "Network card"],
          ["send", "Send"],
          ["shell", "Shell"],
          ["cap", "Capture"],
        ]}
        cur={tab}
        set={setTab}
      />
      {tab === "nic" && (
        <div className="space-y-2 p-3">
          <Kv k="MAC · IPv4" v={`${HOST_MAC[h]} · ${HOST_IP[h]}/24`} />
          <Kv k="Cable" v={up ? `plugged into ${sw} ${stPortName(c.vendor, HOST_PORT)}` : "unplugged"} tone={up ? undefined : "warn"} />
          <Kv k="Its switch port right now" v={up ? `${ROLE_BADGE(s, sw, HOST_PORT).text}${st.wait ? ` — forwards in ${st.wait} s` : ""}` : "—"} tone={st.state === "FWD" ? "ok" : "warn"} />
          <p className="text-[12.5px] text-pv-text-muted">The host&apos;s link comes up the moment the cable is in. Whether its frames get through is the switch port&apos;s decision: an edge port forwards at once; a non-edge port waits for spanning tree.</p>
          <div className="flex flex-wrap gap-1">
            <button type="button" className={btn} onClick={() => c.act({ type: "host", host: h, up: !up })}>
              {up ? "Unplug the cable" : "Plug the cable in"}
            </button>
            <button type="button" className={btn} disabled={!up} onClick={() => c.act({ type: "reseat", host: h })}>
              Reseat (unplug + plug back)
            </button>
          </div>
        </div>
      )}
      {tab === "send" && (
        <div className="space-y-2 p-3">
          <div className="flex flex-wrap gap-1">
            {others.map((o) => (
              <button key={o} type="button" className={btn} disabled={!up} onClick={() => c.act({ type: "traffic", sends: [{ from: h, to: o, kind: "ping" }] })}>
                Ping {o}
              </button>
            ))}
            {others.map((o) => (
              <button key={`a${o}`} type="button" className={btn} disabled={!up} onClick={() => c.act({ type: "traffic", sends: [{ from: h, to: o, kind: "arp" }] })}>
                ARP: who has {HOST_IP[o]}?
              </button>
            ))}
          </div>
        </div>
      )}
      {tab === "shell" && <DevConsole c={c} dev={h} />}
      {tab === "cap" && <CaptureView s={s} points={[h]} vendor={c.vendor} />}
    </>
  );
}

const SUB = (c: StDeskCtx, id: StDev) => (isSw(id) ? `Switch · ${c.view.cfg.sw[id].proto.toUpperCase()} · ${c.vendor === "cisco" ? "Cisco IOS" : "Junos"} view` : `${HOST_IP[id as StHost]} · Linux`);
function Win({ w, c, narrow, focused, onFocus, onMove, onMin, onClose }: { w: StWin; c: StDeskCtx; narrow: boolean; focused: boolean; onFocus: () => void; onMove: (x: number, y: number) => void; onMin: () => void; onClose: () => void }) {
  const drag = useRef<{ dx: number; dy: number } | undefined>(undefined);
  const tone = isSw(w.id) ? "#22d3ee" : "#34d399";
  if (w.id === "ROGUE") return null;
  return (
    <section
      role="dialog"
      aria-label={`${w.id} window`}
      onPointerDown={onFocus}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onMin();
        }
      }}
      className={clsx("flex flex-col overflow-hidden border bg-pv-bg shadow-2xl", narrow ? "fixed inset-0 rounded-none" : "fixed rounded-xl", focused ? "border-pv-cyan/60" : "border-pv-border", w.minimized && "hidden")}
      style={narrow ? { zIndex: 100 + w.z } : { left: w.x, top: w.y, width: "min(860px, calc(100vw - 32px))", height: "min(640px, calc(100vh - 96px))", zIndex: 100 + w.z, resize: "both" }}
    >
      <header
        className={clsx("flex select-none items-center gap-2 border-b border-pv-border px-3 py-2", !narrow && "cursor-move")}
        style={{ background: `linear-gradient(90deg, ${tone}22, transparent)` }}
        onPointerDown={(e) => {
          if (narrow || (e.target as HTMLElement).closest("button")) return;
          drag.current = { dx: e.clientX - w.x, dy: e.clientY - w.y };
          try {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          } catch {
            /* dragging still works without capture */
          }
        }}
        onPointerMove={(e) => drag.current && onMove(Math.max(0, Math.min(window.innerWidth - 120, e.clientX - drag.current.dx)), Math.max(0, Math.min(window.innerHeight - 48, e.clientY - drag.current.dy)))}
        onPointerUp={() => (drag.current = undefined)}
      >
        {narrow && (
          <button type="button" onClick={onMin} className="rounded-full border border-pv-border px-2.5 py-0.5 text-[12px] font-semibold text-pv-text">
            ← Network
          </button>
        )}
        <span className="flex h-7 w-7 items-center justify-center rounded-lg border text-[12px] font-bold" style={{ borderColor: tone, color: tone }} aria-hidden>
          {isSw(w.id) ? "⇄" : "💻"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-bold text-pv-text">{w.id}</p>
          <p className="truncate text-[11px] text-pv-text-faint">{SUB(c, w.id)}</p>
        </div>
        {!narrow && (
          <button type="button" onClick={onMin} aria-label={`Minimize ${w.id}`} className="rounded-md px-2 text-[14px] text-pv-text-faint hover:bg-white/10 hover:text-pv-text">
            –
          </button>
        )}
        <button type="button" onClick={onClose} aria-label={`Close ${w.id}`} className="rounded-md px-2 text-[14px] text-pv-text-faint hover:bg-pv-danger/20 hover:text-pv-text">
          ✕
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{isSw(w.id) ? <SwitchUI c={c} sw={w.id} /> : <HostUI c={c} h={w.id as StHost} />}</div>
    </section>
  );
}
export function StDesk({ windows, setWindows, focus, setFocus, ctx }: { windows: StWin[]; setWindows: (u: (w: StWin[]) => StWin[]) => void; focus?: StDev; setFocus: (n: StDev | undefined) => void; ctx: StDeskCtx }) {
  const narrow = useNarrow();
  if (typeof document === "undefined" || !windows.length) return null;
  const top = Math.max(0, ...windows.map((w) => w.z));
  const raise = (id: StDev) => {
    setFocus(id);
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, z: top + 1, minimized: false } : w)));
  };
  const minimize = (id: StDev) => (setWindows((ws) => ws.map((v) => (v.id === id ? { ...v, minimized: true } : v))), setFocus(undefined));
  return createPortal(
    <>
      {windows.map((w) => (
        <Win key={w.id} w={w} c={ctx} narrow={narrow} focused={focus === w.id} onFocus={() => focus !== w.id && raise(w.id)} onMove={(x, y) => setWindows((ws) => ws.map((v) => (v.id === w.id ? { ...v, x, y } : v)))} onMin={() => minimize(w.id)} onClose={() => (setWindows((ws) => ws.filter((v) => v.id !== w.id)), setFocus(undefined))} />
      ))}
      <nav aria-label="Open devices" className="fixed bottom-3 left-1/2 z-[99] flex max-w-[calc(100vw-24px)] -translate-x-1/2 gap-1 overflow-x-auto rounded-full border border-pv-border bg-pv-bg/95 px-2 py-1 shadow-xl">
        {windows.map((w) => (
          <button key={w.id} type="button" onClick={() => (w.minimized || focus !== w.id ? raise(w.id) : minimize(w.id))} className={clsx("flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold", !w.minimized && focus === w.id ? "bg-pv-cyan/20 text-pv-text" : "text-pv-text-muted hover:text-pv-text")}>
            {w.id}
            {w.minimized && <span className="text-[10px] text-pv-text-faint">(min)</span>}
          </button>
        ))}
      </nav>
    </>,
    document.body,
  );
}
export function openStWindow(ws: StWin[], id: StDev): StWin[] {
  if (id === "ROGUE") return ws;
  const top = Math.max(0, ...ws.map((w) => w.z));
  if (ws.some((w) => w.id === id)) return ws.map((w) => (w.id === id ? { ...w, minimized: false, z: top + 1 } : w));
  const n = ws.length;
  const x = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerWidth - 880, 40 + n * 36));
  const y = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerHeight - 660, 90 + n * 30));
  return [...ws, { id, minimized: false, x, y, z: top + 1 }];
}
