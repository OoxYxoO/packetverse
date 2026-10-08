"use client";

import { clsx } from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CliVendor } from "@/lib/cli/types";
import { maskOf } from "@/lib/sim-engine/scenarios/ipv4Basics";
import { V4_DEV_NAME, V4_HOSTS, V4_R1, v4Routes, type V4Action, type V4Capture, type V4Decision, type V4H, type V4NetState, type V4R1If, type V4RouterStep } from "@/lib/sim-engine/scenarios/ipv4Net";
import { ConsoleTerminal, EMPTY_SESSION, type ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { v4HostSet, v4IfLabel, v4JunosConfig, v4R1Sets, type V4CliApi } from "./v4Cli";
import { AddressLens, CacheTable, CaptureTable, DecisionMath, FrameView, NetworkStrip, RouterPipeline } from "./V4Visuals";

/**
 * IPv4 Lab devices, Packet Tracer style: clicking a host or R1 opens it in its own window (drag, minimize to a tray;
 * full screen on phones). A host shows what it believes (address, prefix, network, gateway, ARP, its last decision),
 * its IPv4 settings, a terminal and a capture. R1 shows its interfaces, connected routes, ARP table, counters and its
 * last forwarding pipeline, a Cisco/Junos console and captures per interface. The switches are not this lesson's
 * subject and have no window.
 */

export type V4WinId = V4H | "r1";
export interface V4Win {
  id: V4WinId;
  minimized: boolean;
  x: number;
  y: number;
  z: number;
}
export interface V4DeskCtx {
  view: V4NetState;
  act: (a: V4Action) => V4NetState;
  busy: boolean;
  vendor: CliVendor;
  setVendor: (v: CliVendor) => void;
  cli: Omit<V4CliApi, "view" | "act" | "history" | "ask">;
  question?: CliQuestion;
  setQuestion: (q: CliQuestion | undefined) => void;
  consoles: Record<string, ConsoleSession>;
  setConsoles: (u: (m: Record<string, ConsoleSession>) => Record<string, ConsoleSession>) => void;
  notes: boolean;
  setNotes: (b: boolean) => void;
  lastDecision: (dev: V4H | "r1") => V4Decision | undefined;
  lastRouter: () => V4RouterStep | undefined;
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
const Note = ({ children }: { children: ReactNode }) => <p className="text-[12px] leading-relaxed text-pv-text-muted">{children}</p>;
const isIp = (s: string) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split(".").every((o) => Number(o) <= 255);
const prefixOfMask = (m: string) => {
  if (!isIp(m)) return undefined;
  for (let p = 0; p <= 32; p++) if (maskOf(p) === m) return p;
  return undefined;
};

function Capture({ c, dev, ifaces }: { c: V4DeskCtx; dev: V4H | "r1"; ifaces: string[] }) {
  const [iface, setIface] = useState(ifaces[0]);
  const [pick, setPick] = useState<V4Capture | undefined>(undefined);
  return (
    <div className="space-y-2">
      {ifaces.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {ifaces.map((i) => (
            <button key={i} type="button" aria-pressed={iface === i} onClick={() => (setIface(i), setPick(undefined))} className={clsx("rounded-md border px-2 py-0.5 pv-mono text-[11.5px]", iface === i ? "border-pv-cyan bg-pv-cyan/15 text-pv-text" : "border-pv-border text-pv-text-muted")}>
              {v4IfLabel(c.vendor, i as V4R1If)} · {V4_R1[i as V4R1If].desc}
            </button>
          ))}
        </div>
      )}
      <Note>Every frame that crossed this interface. Click a row to see its Ethernet and IPv4 fields.</Note>
      <CaptureTable s={c.view} dev={dev} iface={iface} vendor={c.vendor} onPick={setPick} picked={pick?.no} />
      {pick && <FrameView f={pick.frame} note={pick.note} />}
    </div>
  );
}

function Terminal({ c, dev }: { c: V4DeskCtx; dev: V4H | "r1" }) {
  const host = dev !== "r1";
  const os = host ? (V4_HOSTS[dev].os === "windows" ? "windows" : "linux") : c.vendor === "cisco" ? "ios" : "junos";
  const key = `${dev}:${os}`;
  const api: V4CliApi = { ...c.cli, view: c.view, act: c.act, history: c.consoles[key]?.history ?? [], ask: c.setQuestion };
  return (
    <ConsoleTerminal
      key={key}
      sets={host ? { cisco: v4HostSet(api, dev) } : v4R1Sets(api)}
      vendor={host ? "cisco" : c.vendor}
      setVendor={host ? undefined : c.setVendor}
      os={os}
      host={V4_DEV_NAME[dev]}
      session={c.consoles[key] ?? EMPTY_SESSION}
      setSession={(u) => c.setConsoles((m) => ({ ...m, [key]: u(m[key] ?? EMPTY_SESSION) }))}
      notes={c.notes}
      setNotes={c.setNotes}
      question={!host ? c.question : undefined}
      pipeCtx={!host ? { config: v4JunosConfig(c.cli), rollbacks: c.cli.hist.length } : undefined}
      className="h-[min(420px,55vh)]"
    />
  );
}

function Settings({ c, h }: { c: V4DeskCtx; h: V4H }) {
  const cur = c.view.cfg[h];
  const [ip, setIp] = useState(cur.ip);
  const [mask, setMask] = useState(maskOf(cur.prefix));
  const [gw, setGw] = useState(cur.gw ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | undefined>(undefined);
  const dirty = ip !== cur.ip || mask !== maskOf(cur.prefix) || gw !== (cur.gw ?? "");
  const apply = () => {
    const p = prefixOfMask(mask);
    if (!isIp(ip)) return setMsg({ ok: false, text: "Not accepted: the IPv4 address isn't valid." });
    if (p === undefined || p < 8 || p > 30) return setMsg({ ok: false, text: "Not accepted: that isn't a valid subnet mask (e.g. 255.255.255.192)." });
    if (gw && !isIp(gw)) return setMsg({ ok: false, text: "Not accepted: the default gateway isn't a valid address." });
    c.act({ type: "host-cfg", host: h, cfg: { ip, prefix: p, gw: gw || undefined } });
    setMsg({ ok: true, text: "Accepted. That only means the host stored it — check what it now believes (What it knows), then send traffic to prove it works." });
  };
  const field = (label: string, v: string, set: (x: string) => void) => (
    <label className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-2 text-[12.5px]">
      <span className="text-pv-text-muted">{label}</span>
      <input value={v} onChange={(e) => (set(e.target.value.trim()), setMsg(undefined))} spellCheck={false} className="rounded-md border border-pv-border bg-pv-bg px-2 py-1 pv-mono text-[12.5px] text-pv-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan" />
    </label>
  );
  return (
    <div className="space-y-2 rounded-lg border border-pv-border p-2.5">
      <p className="text-[12.5px] font-semibold text-pv-text">{V4_HOSTS[h].os === "windows" ? "Ethernet · Internet Protocol Version 4 (TCP/IPv4) Properties" : "Wired connection · IPv4 (manual)"}</p>
      {field("IPv4 address", ip, setIp)}
      {field("Subnet mask", mask, setMask)}
      {field("Default gateway", gw, setGw)}
      <div className="flex items-center gap-2">
        <button type="button" disabled={!dirty || c.busy} onClick={apply} className="rounded-full bg-pv-cyan px-3 py-1 text-[12px] font-bold text-[#03131a] disabled:opacity-40">
          Apply
        </button>
        <span className="text-[11.5px] text-pv-text-faint">Cabled to {V4_HOSTS[h].port}, LAN {V4_HOSTS[h].lan}.</span>
      </div>
      {msg && <p className={clsx("text-[12px]", msg.ok ? "text-pv-success" : "text-pv-danger")}>{msg.text}</p>}
    </div>
  );
}

function HostUI({ c, h }: { c: V4DeskCtx; h: V4H }) {
  const [tab, setTab] = useState<"knows" | "settings" | "terminal" | "capture">("knows");
  const d = c.lastDecision(h);
  const cfg = c.view.cfg[h];
  return (
    <>
      <Tabs
        tabs={[
          ["knows", "What it believes"],
          ["settings", "Network settings"],
          ["terminal", V4_HOSTS[h].os === "windows" ? "Command Prompt" : "Terminal"],
          ["capture", "Capture eth0"],
        ]}
        cur={tab}
        set={setTab}
      />
      <div className="space-y-2.5 p-3">
        {tab === "knows" && (
          <>
            <AddressLens ip={cfg.ip} prefix={cfg.prefix} name={V4_HOSTS[h].name} />
            <Note>
              Default gateway <span className="pv-mono text-pv-text">{cfg.gw ?? "none"}</span> · MAC <span className="pv-mono">{V4_HOSTS[h].mac}</span>
            </Note>
            {h !== "hostb" && <NetworkStrip s={c.view} owner={h} />}
            <CacheTable s={c.view} owner={h} />
            {d ? (
              <div className="space-y-1">
                <p className="text-[10.5px] font-bold uppercase tracking-wide text-pv-text-faint">Its decision for the last packet it sent</p>
                <DecisionMath d={d} name={V4_HOSTS[h].name} />
              </div>
            ) : (
              <Note>It hasn&apos;t sent anything in the exchange shown.</Note>
            )}
          </>
        )}
        {tab === "settings" && <Settings key={`${cfg.ip}/${cfg.prefix}/${cfg.gw}`} c={c} h={h} />}
        {tab === "terminal" && <Terminal c={c} dev={h} />}
        {tab === "capture" && <Capture c={c} dev={h} ifaces={["eth0"]} />}
      </div>
    </>
  );
}

function R1UI({ c }: { c: V4DeskCtx }) {
  const [tab, setTab] = useState<"state" | "console" | "capture">("state");
  const s = c.view;
  const r = c.lastRouter();
  return (
    <>
      <Tabs
        tabs={[
          ["state", "Interfaces & routes"],
          ["console", "Console"],
          ["capture", "Capture"],
        ]}
        cur={tab}
        set={setTab}
      />
      <div className="space-y-2.5 p-3">
        {tab === "state" && (
          <>
            <div className="overflow-x-auto rounded-xl border border-pv-border">
              <table className="w-full min-w-[460px] text-left text-[12px]">
                <thead className="text-[10.5px] text-pv-text-faint">
                  <tr>
                    <th className="px-2 py-1 font-normal">interface</th>
                    <th className="px-2 font-normal">address</th>
                    <th className="px-2 font-normal">MAC</th>
                    <th className="px-2 font-normal">status</th>
                    <th className="px-2 font-normal">frames in / out</th>
                  </tr>
                </thead>
                <tbody className="pv-mono">
                  {(["ge0", "ge1"] as V4R1If[]).map((i) => (
                    <tr key={i} className="border-t border-pv-border/50">
                      <td className="px-2 py-0.5 text-pv-text">{v4IfLabel(c.vendor, i)}</td>
                      <td className="px-2">
                        {s.r1[i].ip}/{s.r1[i].prefix}
                      </td>
                      <td className="px-2">{V4_R1[i].mac}</td>
                      <td className={clsx("px-2 font-sans", s.r1[i].up ? "text-pv-success" : "text-pv-warning")}>{s.r1[i].up ? "up" : "admin down"}</td>
                      <td className="px-2">
                        {s.counters[i].in} / {s.counters[i].out}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rounded-xl border border-pv-border p-2">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-pv-cyan-soft">Routing table · connected networks only</p>
              {v4Routes(s).length ? (
                v4Routes(s).map((x) => (
                  <p key={x.net} className="pv-mono text-[11.5px] text-pv-text">
                    C {x.net}/{x.prefix} → {v4IfLabel(c.vendor, x.iface)}
                  </p>
                ))
              ) : (
                <p className="pv-mono text-[11.5px] text-pv-text-faint">no routes</p>
              )}
              <p className="mt-1 text-[11px] text-pv-text-faint">
                Packets forwarded {s.counters.forwarded} · TTL expired {s.counters.ttlExpired} · no route {s.counters.noRoute}. Static and dynamic routing are the Routing lesson; here R1 only knows the networks its interfaces are on.
              </p>
            </div>
            <CacheTable s={s} owner="r1" />
            {r ? (
              <div className="space-y-1">
                <p className="text-[10.5px] font-bold uppercase tracking-wide text-pv-text-faint">The last packet R1 handled</p>
                <RouterPipeline r={r} vendor={c.vendor} />
              </div>
            ) : (
              <Note>R1 hasn&apos;t handled a packet in the exchange shown.</Note>
            )}
          </>
        )}
        {tab === "console" && <Terminal c={c} dev="r1" />}
        {tab === "capture" && <Capture c={c} dev="r1" ifaces={["ge0", "ge1"]} />}
      </div>
    </>
  );
}

const KIND: Record<V4WinId, { kind: string; icon: string; tone: string }> = {
  hosta: { kind: "PC", icon: "💻", tone: "#34d399" },
  hostc: { kind: "PC", icon: "💻", tone: "#34d399" },
  hostb: { kind: "PC", icon: "💻", tone: "#34d399" },
  r1: { kind: "Router", icon: "R", tone: "#22d3ee" },
};

function Win({ w, c, narrow, focused, onFocus, onMove, onMin, onClose }: { w: V4Win; c: V4DeskCtx; narrow: boolean; focused: boolean; onFocus: () => void; onMove: (x: number, y: number) => void; onMin: () => void; onClose: () => void }) {
  const k = KIND[w.id];
  const drag = useRef<{ dx: number; dy: number } | undefined>(undefined);
  const sub = w.id === "r1" ? `${v4IfLabel(c.vendor, "ge0")} ${c.view.r1.ge0.ip} · ${v4IfLabel(c.vendor, "ge1")} ${c.view.r1.ge1.ip}` : `${V4_HOSTS[w.id].os === "windows" ? "Windows" : "Linux"} · ${c.view.cfg[w.id].ip}/${c.view.cfg[w.id].prefix} · gw ${c.view.cfg[w.id].gw ?? "none"}`;
  return (
    <section
      role="dialog"
      aria-label={`${V4_DEV_NAME[w.id]} window`}
      onPointerDown={onFocus}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onMin();
        }
      }}
      className={clsx("flex flex-col overflow-hidden border bg-pv-bg shadow-2xl", narrow ? "fixed inset-0 rounded-none" : "fixed rounded-xl", focused ? "border-pv-cyan/60" : "border-pv-border", w.minimized && "hidden")}
      style={narrow ? { zIndex: 100 + w.z } : { left: w.x, top: w.y, width: "min(720px, calc(100vw - 32px))", height: "min(580px, calc(100vh - 96px))", zIndex: 100 + w.z, resize: "both" }}
    >
      <header
        className={clsx("flex select-none items-center gap-2 border-b border-pv-border px-3 py-2", !narrow && "cursor-move")}
        style={{ background: `linear-gradient(90deg, ${k.tone}22, transparent)` }}
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
            ← Topology
          </button>
        )}
        <span className="flex h-7 w-7 items-center justify-center rounded-lg border text-[14px] font-bold" style={{ borderColor: k.tone, color: k.tone }} aria-hidden>
          {k.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-bold text-pv-text">
            {V4_DEV_NAME[w.id]} <span className="font-normal text-pv-text-muted">· {k.kind}</span>
          </p>
          <p className="truncate text-[11px] text-pv-text-faint">{sub}</p>
        </div>
        {!narrow && (
          <button type="button" onClick={onMin} aria-label={`Minimize ${V4_DEV_NAME[w.id]}`} className="rounded-md px-2 text-[14px] text-pv-text-faint hover:bg-white/10 hover:text-pv-text">
            –
          </button>
        )}
        <button type="button" onClick={onClose} aria-label={`Close ${V4_DEV_NAME[w.id]}`} className="rounded-md px-2 text-[14px] text-pv-text-faint hover:bg-pv-danger/20 hover:text-pv-text">
          ✕
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{w.id === "r1" ? <R1UI c={c} /> : <HostUI c={c} h={w.id} />}</div>
    </section>
  );
}

export function V4Desk({ windows, setWindows, focus, setFocus, ctx }: { windows: V4Win[]; setWindows: (u: (w: V4Win[]) => V4Win[]) => void; focus?: V4WinId; setFocus: (n: V4WinId | undefined) => void; ctx: V4DeskCtx }) {
  const narrow = useNarrow();
  if (typeof document === "undefined" || !windows.length) return null;
  const top = Math.max(0, ...windows.map((w) => w.z));
  const raise = (id: V4WinId) => {
    setFocus(id);
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, z: top + 1, minimized: false } : w)));
  };
  const minimize = (id: V4WinId) => (setWindows((ws) => ws.map((v) => (v.id === id ? { ...v, minimized: true } : v))), setFocus(undefined));
  return createPortal(
    <>
      {windows.map((w) => (
        <Win key={w.id} w={w} c={ctx} narrow={narrow} focused={focus === w.id} onFocus={() => focus !== w.id && raise(w.id)} onMove={(x, y) => setWindows((ws) => ws.map((v) => (v.id === w.id ? { ...v, x, y } : v)))} onMin={() => minimize(w.id)} onClose={() => (setWindows((ws) => ws.filter((v) => v.id !== w.id)), setFocus(undefined))} />
      ))}
      <nav aria-label="Open devices" className="fixed bottom-3 left-1/2 z-[99] flex -translate-x-1/2 gap-1 rounded-full border border-pv-border bg-pv-bg/95 px-2 py-1 shadow-xl">
        {windows.map((w) => (
          <button key={w.id} type="button" onClick={() => (w.minimized || focus !== w.id ? raise(w.id) : minimize(w.id))} className={clsx("flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold", !w.minimized && focus === w.id ? "bg-pv-cyan/20 text-pv-text" : "text-pv-text-muted hover:text-pv-text")}>
            <span aria-hidden>{KIND[w.id].icon}</span>
            {V4_DEV_NAME[w.id]}
            {w.minimized && <span className="text-[10px] text-pv-text-faint">(min)</span>}
          </button>
        ))}
      </nav>
    </>,
    document.body,
  );
}

export function openV4Window(ws: V4Win[], id: V4WinId): V4Win[] {
  const top = Math.max(0, ...ws.map((w) => w.z));
  if (ws.some((w) => w.id === id)) return ws.map((w) => (w.id === id ? { ...w, minimized: false, z: top + 1 } : w));
  const n = ws.length;
  const x = typeof window === "undefined" ? 80 : Math.max(16, window.innerWidth - Math.min(720, window.innerWidth - 32) - 24 - n * 32);
  const y = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerHeight - 600, 72 + n * 28));
  return [...ws, { id, minimized: false, x, y, z: top + 1 }];
}
