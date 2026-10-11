"use client";

import { clsx } from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CliVendor } from "@/lib/cli/types";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { ConsoleTerminal, EMPTY_SESSION, type ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import { BCAST, HOST_AT, HOST_IP, HOST_MAC, LC_HOSTS, LC_MEMBERS, LC_PORTS, isSw, lcClone, lcFrameName, lcMacName, lcShortMac, lcTable, otherSw, pk, type LcAction, type LcCap, type LcDev, type LcHost, type LcMember, type LcMemberCfg, type LcMode, type LcSnap, type LcState, type LcSw } from "@/lib/sim-engine/scenarios/lacpNet";
import { lcHostSet, lcJunosConfig, lcSwitchSets, type LcCand, type LcCliApi, type LcIosMode } from "./lcCli";
import { lcPortName } from "./lcNames";

/**
 * LACP Lab devices (drag, minimize to a tray; full screen on phones).
 *   SW1 / SW2  Bundle (each uplink port: cable, channel group, mode, LACP rate, its state and why — change any of it,
 *              unplug a cable, break one silently) · MAC table · Cisco/Junos console · capture (LACPDUs and data) · log
 *   Hosts      send · shell · capture
 */

export interface LcDeskCtx {
  view: LcState;
  snap?: LcSnap;
  act: (a: LcAction) => LcState;
  vendor: CliVendor;
  setVendor: (v: CliVendor) => void;
  ios: Record<LcSw, LcIosMode>;
  setIos: (d: LcSw, m: LcIosMode) => void;
  junosEdit: Record<LcSw, boolean>;
  setJunosEdit: (d: LcSw, b: boolean) => void;
  cand: LcCand;
  setCand: (c: LcCand) => void;
  consoles: Record<string, ConsoleSession>;
  setConsoles: (u: (m: Record<string, ConsoleSession>) => Record<string, ConsoleSession>) => void;
  notes: boolean;
  setNotes: (b: boolean) => void;
  question?: CliQuestion;
  setQuestion: (q: CliQuestion | undefined) => void;
}
export interface LcWin {
  id: LcDev;
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
const STATE_TONE: Record<string, string> = { bundled: "bg-pv-success/15 text-pv-success", suspended: "bg-pv-danger/20 text-pv-danger", errdis: "bg-pv-danger/20 text-pv-danger", individual: "bg-black/40 text-pv-text-muted", down: "bg-black/40 text-pv-text-faint", hot: "bg-pv-warning/20 text-pv-warning" };
export const StateBadge = ({ s, sw, m }: { s: LcState; sw: LcSw; m: LcMember }) => {
  const i = s.bundle.members[pk(sw, m)];
  return <span className={clsx("pv-mono rounded px-1 text-[11px] font-bold", STATE_TONE[i.state])}>{i.state === "errdis" ? "err-disabled" : i.state}</span>;
};

export const capPoints = (s: LcState): string[] => [...(["SW1", "SW2"] as LcSw[]).flatMap((sw) => LC_PORTS.filter((p) => !(LC_MEMBERS as readonly string[]).includes(p) || s.cfg.cables[p as LcMember]).map((p) => pk(sw, p))), ...LC_HOSTS];
export const capLabel = (vendor: CliVendor, p: string) => (p.includes(" ") ? `${p.split(" ")[0]} ${lcPortName(vendor, p.split(" ")[1])}` : p);
export function CaptureView({ s, points, initial, vendor }: { s: LcState; points: string[]; initial?: string; vendor: CliVendor }) {
  const [point, setPoint] = useState<string>(initial && points.includes(initial) ? initial : points[0]);
  const [onlyLast, setOnlyLast] = useState(true);
  const [pick, setPick] = useState<LcCap | undefined>(undefined);
  const rows = s.captures.filter((c) => c.point === point && (!onlyLast || !s.last || c.run === s.last.id)).slice(-120);
  return (
    <div className="space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-pv-text-muted">
        {points.length > 1 && (
          <select value={point} onChange={(e) => (setPoint(e.target.value), setPick(undefined))} className="rounded-md border border-pv-border bg-pv-bg px-2 py-0.5 text-[12px] text-pv-text" aria-label="Capture point">
            {points.map((p) => (
              <option key={p} value={p}>
                {capLabel(vendor, p)}
              </option>
            ))}
          </select>
        )}
        <label className="ml-auto flex items-center gap-1">
          <input type="checkbox" checked={onlyLast} onChange={(e) => setOnlyLast(e.target.checked)} /> last run only
        </label>
      </div>
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-pv-text-faint">Nothing crossed {capLabel(vendor, point)}{onlyLast ? " during the last run" : ""}. On a bundle member, silence can mean the hash sent the flow down another member.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-[12px]">
            <thead className="text-[11px] text-pv-text-faint">
              <tr>
                <th className="px-1.5 py-1">#</th>
                <th className="px-1.5 py-1">dir</th>
                <th className="px-1.5 py-1">src → dst MAC</th>
                <th className="px-1.5 py-1">what</th>
              </tr>
            </thead>
            <tbody className="pv-mono">
              {rows.map((c) => (
                <tr key={c.n} onClick={() => setPick(c)} className={clsx("cursor-pointer border-t border-pv-border/50 hover:bg-white/[0.03]", pick?.n === c.n && "bg-pv-cyan/10", c.frame.kind === "lacpdu" && "text-pv-violet")}>
                  <td className="px-1.5 py-0.5">{c.n}</td>
                  <td className="px-1.5 py-0.5">{c.dir}</td>
                  <td className="px-1.5 py-0.5">
                    {lcShortMac(c.frame.src)} → {c.frame.dst === BCAST ? "broadcast" : c.frame.kind === "lacpdu" ? "01:80:C2:00:00:02" : lcShortMac(c.frame.dst)}
                  </td>
                  <td className="px-1.5 py-0.5 font-sans">{lcFrameName(c.frame)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pick && (
        <div className="rounded-xl border border-pv-border bg-pv-bg/60 p-2.5 text-[12.5px]">
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Kv k="Destination MAC" v={pick.frame.dst} />
            <Kv k="Source MAC" v={`${pick.frame.src} (${lcMacName(pick.frame.src)})`} />
            {pick.frame.kind === "lacpdu" ? (
              <>
                <Kv k="EtherType · subtype" v="0x8809 (Slow Protocols) · 0x01 (LACP)" />
                <Kv k="Actor" v={`system ${pick.frame.src} · key = channel group`} />
              </>
            ) : (
              <>
                <Kv k="EtherType" v={pick.frame.kind.startsWith("arp") ? "0x0806 (ARP)" : "0x0800 (IPv4)"} />
                <Kv k="Flow (hash input)" v={pick.frame.flow ? `.${pick.frame.flow.replace("-", " → .")}` : "—"} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function cliApi(c: LcDeskCtx, key: string): LcCliApi {
  return { view: c.view, act: c.act, ios: c.ios, setIos: c.setIos, junosEdit: c.junosEdit, setJunosEdit: c.setJunosEdit, cand: c.cand, setCand: c.setCand, ask: c.setQuestion, history: c.consoles[key]?.history ?? [] };
}
export function DevConsole({ c, dev, className }: { c: LcDeskCtx; dev: LcDev; className?: string }) {
  const host = !isSw(dev);
  const os = host ? "linux" : c.vendor === "cisco" ? "ios" : "junos";
  const key = `${dev}:${os}`;
  const api = cliApi(c, key);
  const sets = host ? { cisco: lcHostSet(api, dev as LcHost), juniper: lcHostSet(api, dev as LcHost) } : lcSwitchSets(api, dev as LcSw);
  return <ConsoleTerminal key={key} sets={sets} vendor={c.vendor} setVendor={host ? undefined : c.setVendor} os={os} host={dev} session={c.consoles[key] ?? EMPTY_SESSION} setSession={(u) => c.setConsoles((m) => ({ ...m, [key]: u(m[key] ?? EMPTY_SESSION) }))} notes={c.notes} setNotes={c.setNotes} question={c.question?.node === dev ? c.question : undefined} pipeCtx={host ? undefined : { config: lcJunosConfig(api, dev as LcSw), rollbacks: 1 }} className={className ?? "h-[min(440px,58vh)]"} />;
}

function SwitchUI({ c, sw }: { c: LcDeskCtx; sw: LcSw }) {
  const [tab, setTab] = useState<"bundle" | "mac" | "term" | "cap" | "log">("bundle");
  const s = c.view;
  const cfg = s.cfg;
  const setMember = (m: LcMember, patch: Partial<LcMemberCfg>, text: string) => {
    const n = lcClone(cfg);
    n.sw[sw].members[m] = { ...n.sw[sw].members[m], ...patch };
    c.act({ type: "cfg", cfg: n, text: `${sw} ${m}: ${text}` });
  };
  const logs = s.syslog.filter((l) => l.sw === sw);
  return (
    <>
      <Tabs
        tabs={[
          ["bundle", "Bundle"],
          ["mac", "MAC table"],
          ["term", "Console"],
          ["cap", "Capture"],
          ["log", "Log"],
        ]}
        cur={tab}
        set={setTab}
      />
      {tab === "bundle" && (
        <div className="space-y-2 p-3">
          <p className="text-[12.5px] text-pv-text-muted">Each uplink port toward {otherSw(sw)}: its channel group ({lcPortName(c.vendor, "Po1")} / {lcPortName(c.vendor, "Po2")}), its mode, and what it actually became. A member carries traffic only when it is bundled at <b className="text-pv-text">both</b> ends.</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-[12px]">
              <thead className="text-[11px] text-pv-text-faint">
                <tr>
                  <th className="px-1.5 py-1">port</th>
                  <th className="px-1.5 py-1">group · mode</th>
                  <th className="px-1.5 py-1">LACP rate</th>
                  <th className="px-1.5 py-1">state · why</th>
                  <th className="px-1.5 py-1">cable</th>
                </tr>
              </thead>
              <tbody>
                {LC_MEMBERS.map((m) => {
                  const mc = cfg.sw[sw].members[m];
                  const info = s.bundle.members[pk(sw, m)];
                  return (
                    <tr key={m} className="border-t border-pv-border/50 align-top">
                      <td className="pv-mono whitespace-nowrap px-1.5 py-1 text-pv-text">{lcPortName(c.vendor, m)}</td>
                      <td className="whitespace-nowrap px-1.5 py-1">
                        <select aria-label={`${sw} ${m} group`} className={sel} value={mc.group} disabled={mc.mode === "off"} onChange={(e) => setMember(m, { group: +e.target.value as 1 | 2 }, `channel group ${e.target.value}`)}>
                          <option value={1}>{lcPortName(c.vendor, "Po1")}</option>
                          <option value={2}>{lcPortName(c.vendor, "Po2")}</option>
                        </select>{" "}
                        <select aria-label={`${sw} ${m} mode`} className={sel} value={mc.mode} onChange={(e) => setMember(m, { mode: e.target.value as LcMode }, `mode ${e.target.value}`)}>
                          <option value="active">LACP active</option>
                          <option value="passive">LACP passive</option>
                          <option value="on">static (on)</option>
                          <option value="off">not in a group</option>
                        </select>
                      </td>
                      <td className="px-1.5 py-1">
                        <label className="inline-flex items-center gap-1 text-[11.5px] text-pv-text-muted">
                          <input type="checkbox" checked={mc.fast} aria-label={`${sw} ${m} fast rate`} onChange={(e) => setMember(m, { fast: e.target.checked }, `LACP rate ${e.target.checked ? "fast" : "slow"}`)} />
                          fast
                        </label>
                      </td>
                      <td className="px-1.5 py-1">
                        <StateBadge s={s} sw={sw} m={m} /> <span className="text-[11.5px] text-pv-text-muted">{info.why}</span>
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-1">
                        <button type="button" className={btn} onClick={() => c.act({ type: "cable", member: m, up: !cfg.cables[m] })}>
                          {cfg.cables[m] ? "Unplug" : "Plug in"}
                        </button>
                        {cfg.cables[m] && (
                          <button type="button" className={clsx(btn, "ml-1")} onClick={() => c.act({ type: "silent", member: m, on: s.silent[m] === undefined })}>
                            {s.silent[m] === undefined ? "Fail silently" : "Repair"}
                          </button>
                        )}
                        <button type="button" className={clsx(btn, "ml-1")} onClick={() => setMember(m, { shut: !mc.shut }, mc.shut ? "enabled" : "disabled")}>
                          {mc.shut ? "Enable" : "Disable"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="space-y-0.5 text-[12px] text-pv-text-muted">
            {s.bundle.logical.length === 0 ? (
              <p className="text-pv-danger">No working link between SW1 and SW2.</p>
            ) : (
              s.bundle.logical.map((l) => (
                <p key={l.id} className="pv-mono">
                  {l.kind === "po" ? `${lcPortName(c.vendor, l.ends[sw])}: ${l.members.length} × 1 Gb/s (${l.members.map((m) => lcPortName(c.vendor, m)).join(", ")})` : `${lcPortName(c.vendor, l.id)}: a single 1 Gb/s link`} · STP cost {l.cost} · <span className={l.stp === "fwd" ? "text-pv-success" : "text-pv-warning"}>{l.stp === "fwd" ? "forwarding" : "blocked by STP"}</span>
                </p>
              ))
            )}
          </div>
        </div>
      )}
      {tab === "mac" && (
        <div className="space-y-2 p-3">
          {lcTable((c.snap ?? s).fdb, sw).length === 0 ? (
            <p className="text-[12.5px] text-pv-text-faint">Empty.</p>
          ) : (
            <table className="w-full text-left text-[12px]">
              <tbody className="pv-mono">
                {lcTable((c.snap ?? s).fdb, sw).map((e) => (
                  <tr key={e.mac} className="border-t border-pv-border/50">
                    <td className="px-1.5 py-0.5">{e.mac}</td>
                    <td className="px-1.5 py-0.5 font-semibold text-pv-text">{lcMacName(e.mac)}</td>
                    <td className="px-1.5 py-0.5">{lcPortName(c.vendor, e.port)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-[11.5px] text-pv-text-muted">Hosts behind the bundle are learned on the Port-channel, not on a member.</p>
        </div>
      )}
      {tab === "term" && <DevConsole c={c} dev={sw} />}
      {tab === "cap" && <CaptureView s={s} points={capPoints(s).filter((p) => p.startsWith(sw))} initial={pk(sw, "ge-0/0/23")} vendor={c.vendor} />}
      {tab === "log" && (
        <div className="space-y-1 p-3 text-[12.5px]">
          {logs.length === 0 ? (
            <p className="text-pv-text-faint">No events.</p>
          ) : (
            logs.slice(-40).map((l, i) => (
              <p key={i} className={clsx("pv-mono text-[12px]", ["suspend", "errdis", "timeout"].includes(l.ev) ? "text-pv-danger" : l.ev === "unbundle" || l.ev === "stp" ? "text-pv-warning" : "text-pv-text-muted")}>
                t={l.clock - 7200}s · {lcPortName(c.vendor, l.port)} {l.ev === "bundle" ? `joined ${lcPortName(c.vendor, l.text!)}` : l.ev === "unbundle" ? `left ${lcPortName(c.vendor, l.text!)}` : l.ev === "timeout" ? `timed out (LACPDUs stopped) — left ${lcPortName(c.vendor, l.text!)}` : l.ev === "suspend" ? `suspended: ${l.text}` : l.ev === "errdis" ? "err-disabled (misconfiguration guard)" : l.ev === "stp" ? `spanning tree: ${l.text}` : `link ${l.ev}`}
              </p>
            ))
          )}
        </div>
      )}
    </>
  );
}
function HostUI({ c, h }: { c: LcDeskCtx; h: LcHost }) {
  const [tab, setTab] = useState<"send" | "shell" | "cap">("send");
  const others = LC_HOSTS.filter((x) => x !== h);
  return (
    <>
      <Tabs
        tabs={[
          ["send", "Send"],
          ["shell", "Shell"],
          ["cap", "Capture"],
        ]}
        cur={tab}
        set={setTab}
      />
      {tab === "send" && (
        <div className="space-y-2 p-3">
          <Kv k="MAC · IPv4" v={`${HOST_MAC[h]} · ${HOST_IP[h]}/24`} />
          <Kv k="Plugged into" v={`${HOST_AT[h].sw} ${lcPortName(c.vendor, HOST_AT[h].port)}`} />
          <div className="flex flex-wrap gap-1">
            {others.map((o) => (
              <button key={o} type="button" className={btn} onClick={() => c.act({ type: "traffic", sends: [{ from: h, to: o, kind: "ping" }] })}>
                Ping {o}
              </button>
            ))}
          </div>
        </div>
      )}
      {tab === "shell" && <DevConsole c={c} dev={h} />}
      {tab === "cap" && <CaptureView s={c.view} points={[h]} vendor={c.vendor} />}
    </>
  );
}
function Win({ w, c, narrow, focused, onFocus, onMove, onMin, onClose }: { w: LcWin; c: LcDeskCtx; narrow: boolean; focused: boolean; onFocus: () => void; onMove: (x: number, y: number) => void; onMin: () => void; onClose: () => void }) {
  const drag = useRef<{ dx: number; dy: number } | undefined>(undefined);
  const tone = isSw(w.id) ? "#22d3ee" : "#34d399";
  return (
    <section role="dialog" aria-label={`${w.id} window`} onPointerDown={onFocus} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onMin(); } }} className={clsx("flex flex-col overflow-hidden border bg-pv-bg shadow-2xl", narrow ? "fixed inset-0 rounded-none" : "fixed rounded-xl", focused ? "border-pv-cyan/60" : "border-pv-border", w.minimized && "hidden")} style={narrow ? { zIndex: 100 + w.z } : { left: w.x, top: w.y, width: "min(880px, calc(100vw - 32px))", height: "min(640px, calc(100vh - 96px))", zIndex: 100 + w.z, resize: "both" }}>
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
          <p className="truncate text-[11px] text-pv-text-faint">{isSw(w.id) ? `Switch · ${c.vendor === "cisco" ? "Cisco IOS" : "Junos"} view` : `${HOST_IP[w.id as LcHost]} · Linux`}</p>
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
      <div className="min-h-0 flex-1 overflow-y-auto">{isSw(w.id) ? <SwitchUI c={c} sw={w.id} /> : <HostUI c={c} h={w.id as LcHost} />}</div>
    </section>
  );
}
export function LcDesk({ windows, setWindows, focus, setFocus, ctx }: { windows: LcWin[]; setWindows: (u: (w: LcWin[]) => LcWin[]) => void; focus?: LcDev; setFocus: (n: LcDev | undefined) => void; ctx: LcDeskCtx }) {
  const narrow = useNarrow();
  if (typeof document === "undefined" || !windows.length) return null;
  const top = Math.max(0, ...windows.map((w) => w.z));
  const raise = (id: LcDev) => {
    setFocus(id);
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, z: top + 1, minimized: false } : w)));
  };
  const minimize = (id: LcDev) => (setWindows((ws) => ws.map((v) => (v.id === id ? { ...v, minimized: true } : v))), setFocus(undefined));
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
export function openLcWindow(ws: LcWin[], id: LcDev): LcWin[] {
  const top = Math.max(0, ...ws.map((w) => w.z));
  if (ws.some((w) => w.id === id)) return ws.map((w) => (w.id === id ? { ...w, minimized: false, z: top + 1 } : w));
  const n = ws.length;
  const x = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerWidth - 900, 40 + n * 36));
  const y = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerHeight - 660, 90 + n * 30));
  return [...ws, { id, minimized: false, x, y, z: top + 1 }];
}
