"use client";

import { clsx } from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CliVendor } from "@/lib/cli/types";
import { DEV_NAME, HOSTS, R1_IFS, SW_PORTS, SW_PORT_PEER, isIp, maskOf, portUp, prefixOfMask, type ArpAction, type ArpCapture, type ArpDev, type ArpHost, type ArpNetState, type SendDecision } from "@/lib/sim-engine/scenarios/arpNet";
import { ConsoleTerminal, EMPTY_SESSION, type ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import { arpHostSet, arpIfName, arpR1Sets, arpSwSets, type ArpCliApi } from "./arpNetCli";
import { CacheTable, CaptureTable, DecisionChain, FrameView, MacTableView } from "./ArpVisuals";

/**
 * ARP Lab devices, Packet Tracer style: clicking a device opens it in its own window (drag, minimize to a tray; full
 * screen on phones). Each device shows what IT knows: a host its IPv4 settings, its ARP cache, the decision it took
 * for its last packet, a terminal and a capture on its card; SW1 its ports and MAC table (no ARP); R1 its ARP table on
 * both sides, a console and captures. All of it reads the moment the topology shows.
 */

export interface ArpWin {
  id: ArpDev;
  minimized: boolean;
  x: number;
  y: number;
  z: number;
}
const KIND: Record<ArpDev, { kind: string; icon: string; tone: string; model: string }> = {
  laptop: { kind: "PC", icon: "💻", tone: "#34d399", model: "Windows · 192.168.10.10/24" },
  pcb: { kind: "PC", icon: "💻", tone: "#34d399", model: "Linux · 192.168.10.20/24" },
  pcc: { kind: "PC", icon: "💻", tone: "#34d399", model: "Windows · 192.168.10.30/24" },
  server: { kind: "Server", icon: "🗄", tone: "#a78bfa", model: "Linux · 10.20.20.20/24" },
  sw1: { kind: "Switch", icon: "⇄", tone: "#94a3b8", model: "Access switch · Layer 2 · no IP on this LAN" },
  r1: { kind: "Router", icon: "R", tone: "#22d3ee", model: "Default gateway · Gi0/0 192.168.10.1 · Gi0/1 10.20.20.1" },
};

export interface ArpDeskCtx {
  view: ArpNetState;
  /** Run an action (finishes any exchange playing first); returns the resulting network. */
  act: (a: ArpAction | ArpAction[]) => ArpNetState;
  busy: boolean;
  vendor: CliVendor;
  setVendor: (v: CliVendor) => void;
  sw: ArpCliApi["sw"];
  consoles: Record<string, ConsoleSession>;
  setConsoles: (u: (m: Record<string, ConsoleSession>) => Record<string, ConsoleSession>) => void;
  notes: boolean;
  setNotes: (b: boolean) => void;
  /** The last decision each device took (from the exchange shown). */
  lastDecision: (dev: ArpHost | "r1") => SendDecision | undefined;
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

function Capture({ c, dev, ifaces }: { c: ArpDeskCtx; dev: ArpDev; ifaces: string[] }) {
  const [iface, setIface] = useState(ifaces[0]);
  const [pick, setPick] = useState<ArpCapture | undefined>(undefined);
  return (
    <div className="space-y-2">
      {ifaces.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {ifaces.map((i) => (
            <button key={i} type="button" aria-pressed={iface === i} onClick={() => (setIface(i), setPick(undefined))} className={clsx("rounded-md border px-2 py-0.5 pv-mono text-[11.5px]", iface === i ? "border-pv-cyan bg-pv-cyan/15 text-pv-text" : "border-pv-border text-pv-text-muted")}>
              {dev === "sw1" ? `${arpIfName(c.vendor, "sw1", i)} · ${DEV_NAME[SW_PORT_PEER[i as keyof typeof SW_PORT_PEER]]}` : dev === "r1" ? arpIfName(c.vendor, "r1", i) : i}
            </button>
          ))}
        </div>
      )}
      <Note>Every frame that crossed this interface, in or out. Click a row to see its fields.</Note>
      <CaptureTable s={c.view} dev={dev} iface={iface} vendor={c.vendor} onPick={setPick} picked={pick?.no} />
      {pick && <FrameView f={pick.frame} note={pick.note} />}
    </div>
  );
}

function Terminal({ c, dev }: { c: ArpDeskCtx; dev: ArpDev }) {
  const host = dev !== "sw1" && dev !== "r1";
  const os = host ? (HOSTS[dev as ArpHost].os === "windows" ? "windows" : "linux") : c.vendor === "cisco" ? "ios" : "junos";
  const key = `${dev}:${os}`;
  const api: ArpCliApi = { view: c.view, act: c.act, history: c.consoles[key]?.history ?? [], sw: c.sw };
  const sets = host ? { cisco: arpHostSet(api, dev as ArpHost) } : dev === "r1" ? arpR1Sets(api) : arpSwSets(api);
  return (
    <ConsoleTerminal
      key={key}
      sets={sets}
      vendor={host ? "cisco" : c.vendor}
      setVendor={host ? undefined : c.setVendor}
      os={os}
      host={DEV_NAME[dev]}
      session={c.consoles[key] ?? EMPTY_SESSION}
      setSession={(u) => c.setConsoles((m) => ({ ...m, [key]: u(m[key] ?? EMPTY_SESSION) }))}
      notes={c.notes}
      setNotes={c.setNotes}
      className="h-[min(420px,55vh)]"
    />
  );
}

function Settings({ c, h }: { c: ArpDeskCtx; h: ArpHost }) {
  const cur = c.view.cfg[h];
  const [ip, setIp] = useState(cur.ip);
  const [mask, setMask] = useState(maskOf(cur.prefix));
  const [gw, setGw] = useState(cur.gw ?? "");
  const [err, setErr] = useState<string | undefined>(undefined);
  const pre = prefixOfMask(mask);
  const dirty = ip !== cur.ip || mask !== maskOf(cur.prefix) || gw !== (cur.gw ?? "");
  const apply = () => {
    if (!isIp(ip)) return setErr("The IPv4 address isn't valid.");
    if (pre === undefined || pre < 8 || pre > 30) return setErr("The subnet mask isn't a valid mask (e.g. 255.255.255.0).");
    if (gw && !isIp(gw)) return setErr("The default gateway isn't a valid address.");
    setErr(undefined);
    c.act({ type: "host-cfg", host: h, cfg: { ip, prefix: pre, gw: gw || undefined } });
  };
  const field = (label: string, v: string, set: (x: string) => void) => (
    <label className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-2 text-[12.5px]">
      <span className="text-pv-text-muted">{label}</span>
      <input value={v} onChange={(e) => set(e.target.value.trim())} spellCheck={false} className="rounded-md border border-pv-border bg-pv-bg px-2 py-1 pv-mono text-[12.5px] text-pv-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan" />
    </label>
  );
  return (
    <div className="space-y-2 rounded-lg border border-pv-border p-2.5">
      <p className="text-[12.5px] font-semibold text-pv-text">{HOSTS[h].os === "windows" ? "Ethernet · Internet Protocol Version 4 (TCP/IPv4) Properties" : "Wired connection · IPv4 (manual)"}</p>
      {field("IPv4 address", ip, setIp)}
      {field("Subnet mask", mask, setMask)}
      {field("Default gateway", gw, setGw)}
      {err && <p className="text-[12px] text-pv-danger">{err}</p>}
      <div className="flex items-center gap-2">
        <button type="button" disabled={!dirty || c.busy} onClick={apply} className="rounded-full bg-pv-cyan px-3 py-1 text-[12px] font-bold text-[#03131a] disabled:opacity-40">
          Apply
        </button>
        <span className="text-[11.5px] text-pv-text-faint">Changing the address or mask clears this host&apos;s learned ARP entries.</span>
      </div>
    </div>
  );
}

function HostUI({ c, h }: { c: ArpDeskCtx; h: ArpHost }) {
  const [tab, setTab] = useState<"knows" | "settings" | "terminal" | "capture">("knows");
  const d = c.lastDecision(h);
  return (
    <>
      <Tabs
        tabs={[
          ["knows", "What it knows"],
          ["settings", "Network settings"],
          ["terminal", HOSTS[h].os === "windows" ? "Command Prompt" : "Terminal"],
          ["capture", "Capture eth0"],
        ]}
        cur={tab}
        set={setTab}
      />
      <div className="space-y-2.5 p-3">
        {tab === "knows" && (
          <>
            <Note>
              {HOSTS[h].name} · {c.view.cfg[h].ip}/{c.view.cfg[h].prefix} · gateway {c.view.cfg[h].gw ?? "none"} · MAC <span className="pv-mono">{HOSTS[h].mac}</span> · {c.view.power[h] ? "powered on" : "powered off"}
            </Note>
            <CacheTable s={c.view} owner={h} />
            {d ? (
              <div className="space-y-1">
                <p className="text-[10.5px] font-bold uppercase tracking-wide text-pv-text-faint">Its decision for the last packet it sent</p>
                <DecisionChain d={d} />
              </div>
            ) : (
              <Note>It hasn&apos;t sent anything in the exchange shown.</Note>
            )}
          </>
        )}
        {tab === "settings" && (
          <>
            <Settings key={`${c.view.cfg[h].ip}/${c.view.cfg[h].prefix}/${c.view.cfg[h].gw}`} c={c} h={h} />
            <div className="flex items-center gap-2">
              <button type="button" disabled={c.busy} onClick={() => c.act({ type: "power", host: h, on: !c.view.power[h] })} className="rounded-full border border-pv-border px-3 py-1 text-[12px] font-semibold text-pv-text hover:border-pv-cyan/60 disabled:opacity-40">
                {c.view.power[h] ? "Power off" : "Power on"}
              </button>
              <span className="text-[11.5px] text-pv-text-faint">Powered off, it can&apos;t hear or answer anything{h !== "server" ? " (its switch port loses link)" : ""}.</span>
            </div>
          </>
        )}
        {tab === "terminal" && <Terminal c={c} dev={h} />}
        {tab === "capture" && <Capture c={c} dev={h} ifaces={["eth0"]} />}
      </div>
    </>
  );
}

function SwUI({ c }: { c: ArpDeskCtx }) {
  const [tab, setTab] = useState<"ports" | "console" | "capture">("ports");
  return (
    <>
      <Tabs
        tabs={[
          ["ports", "Ports & MAC table"],
          ["console", "Console"],
          ["capture", "Capture"],
        ]}
        cur={tab}
        set={setTab}
      />
      <div className="space-y-2.5 p-3">
        {tab === "ports" && (
          <>
            <div className="grid grid-cols-4 gap-1.5 rounded-xl border border-pv-border bg-[#0b1018] p-2">
              {SW_PORTS.map((p) => {
                const up = portUp(c.view, p);
                const shut = c.view.swShut.includes(p);
                return (
                  <div key={p} className="rounded-lg border border-pv-border px-1 py-1 text-center">
                    <span className={clsx("mx-auto block h-2.5 w-2.5 rounded-full", shut ? "bg-pv-warning" : up ? "bg-pv-success" : "bg-white/15")} aria-hidden />
                    <span className="mt-0.5 block truncate pv-mono text-[10.5px] font-bold text-pv-text">{arpIfName(c.vendor, "sw1", p)}</span>
                    <span className="block truncate text-[10px] text-pv-text-muted">{shut ? "shut down" : up ? `→ ${DEV_NAME[SW_PORT_PEER[p]]}` : "no link"}</span>
                  </div>
                );
              })}
            </div>
            <MacTableView s={c.view} vendor={c.vendor} />
            <Note>SW1 has no IP address on this LAN, so it has no ARP cache at all. It learns MAC → port from the source of every frame — ARP frames included — and floods broadcasts without reading what&apos;s inside.</Note>
          </>
        )}
        {tab === "console" && <Terminal c={c} dev="sw1" />}
        {tab === "capture" && <Capture c={c} dev="sw1" ifaces={[...SW_PORTS]} />}
      </div>
    </>
  );
}

function R1UI({ c }: { c: ArpDeskCtx }) {
  const [tab, setTab] = useState<"knows" | "console" | "capture">("knows");
  const d = c.lastDecision("r1");
  return (
    <>
      <Tabs
        tabs={[
          ["knows", "What it knows"],
          ["console", "Console"],
          ["capture", "Capture"],
        ]}
        cur={tab}
        set={setTab}
      />
      <div className="space-y-2.5 p-3">
        {tab === "knows" && (
          <>
            <Note>
              {arpIfName(c.vendor, "r1", "gi0")} {R1_IFS.gi0.ip}/24 (LAN) · {arpIfName(c.vendor, "r1", "gi1")} {R1_IFS.gi1.ip}/24 (Server segment). Two links, two broadcast domains: an ARP broadcast never crosses R1.
            </Note>
            <CacheTable s={c.view} owner="r1" />
            {d ? (
              <div className="space-y-1">
                <p className="text-[10.5px] font-bold uppercase tracking-wide text-pv-text-faint">Its last forwarding decision</p>
                <DecisionChain d={d} />
              </div>
            ) : (
              <Note>R1 hasn&apos;t forwarded anything in the exchange shown.</Note>
            )}
          </>
        )}
        {tab === "console" && <Terminal c={c} dev="r1" />}
        {tab === "capture" && <Capture c={c} dev="r1" ifaces={["gi0", "gi1"]} />}
      </div>
    </>
  );
}

function Win({ w, c, narrow, focused, onFocus, onMove, onMin, onClose }: { w: ArpWin; c: ArpDeskCtx; narrow: boolean; focused: boolean; onFocus: () => void; onMove: (x: number, y: number) => void; onMin: () => void; onClose: () => void }) {
  const k = KIND[w.id];
  const drag = useRef<{ dx: number; dy: number } | undefined>(undefined);
  const model = w.id === "sw1" || w.id === "r1" ? k.model : `${HOSTS[w.id].os === "windows" ? "Windows" : "Linux"} · ${c.view.cfg[w.id].ip}/${c.view.cfg[w.id].prefix}`;
  return (
    <section
      role="dialog"
      aria-label={`${DEV_NAME[w.id]} window`}
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
            {DEV_NAME[w.id]} <span className="font-normal text-pv-text-muted">· {k.kind}</span>
          </p>
          <p className="truncate text-[11px] text-pv-text-faint">{model}</p>
        </div>
        {!narrow && (
          <button type="button" onClick={onMin} aria-label={`Minimize ${DEV_NAME[w.id]}`} className="rounded-md px-2 text-[14px] text-pv-text-faint hover:bg-white/10 hover:text-pv-text">
            –
          </button>
        )}
        <button type="button" onClick={onClose} aria-label={`Close ${DEV_NAME[w.id]}`} className="rounded-md px-2 text-[14px] text-pv-text-faint hover:bg-pv-danger/20 hover:text-pv-text">
          ✕
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{w.id === "sw1" ? <SwUI c={c} /> : w.id === "r1" ? <R1UI c={c} /> : <HostUI c={c} h={w.id} />}</div>
    </section>
  );
}

export function ArpDesk({ windows, setWindows, focus, setFocus, ctx }: { windows: ArpWin[]; setWindows: (u: (w: ArpWin[]) => ArpWin[]) => void; focus?: ArpDev; setFocus: (n: ArpDev | undefined) => void; ctx: ArpDeskCtx }) {
  const narrow = useNarrow();
  if (typeof document === "undefined" || !windows.length) return null;
  const top = Math.max(0, ...windows.map((w) => w.z));
  const raise = (id: ArpDev) => {
    setFocus(id);
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, z: top + 1, minimized: false } : w)));
  };
  const minimize = (id: ArpDev) => (setWindows((ws) => ws.map((v) => (v.id === id ? { ...v, minimized: true } : v))), setFocus(undefined));
  return createPortal(
    <>
      {windows.map((w) => (
        <Win
          key={w.id}
          w={w}
          c={ctx}
          narrow={narrow}
          focused={focus === w.id}
          onFocus={() => focus !== w.id && raise(w.id)}
          onMove={(x, y) => setWindows((ws) => ws.map((v) => (v.id === w.id ? { ...v, x, y } : v)))}
          onMin={() => minimize(w.id)}
          onClose={() => (setWindows((ws) => ws.filter((v) => v.id !== w.id)), setFocus(undefined))}
        />
      ))}
      <nav aria-label="Open devices" className="fixed bottom-3 left-1/2 z-[99] flex -translate-x-1/2 gap-1 rounded-full border border-pv-border bg-pv-bg/95 px-2 py-1 shadow-xl">
        {windows.map((w) => (
          <button key={w.id} type="button" onClick={() => (w.minimized || focus !== w.id ? raise(w.id) : minimize(w.id))} className={clsx("flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold", !w.minimized && focus === w.id ? "bg-pv-cyan/20 text-pv-text" : "text-pv-text-muted hover:text-pv-text")}>
            <span aria-hidden>{KIND[w.id].icon}</span>
            {DEV_NAME[w.id]}
            {w.minimized && <span className="text-[10px] text-pv-text-faint">(min)</span>}
          </button>
        ))}
      </nav>
    </>,
    document.body,
  );
}

export function openArpWindow(ws: ArpWin[], id: ArpDev): ArpWin[] {
  const top = Math.max(0, ...ws.map((w) => w.z));
  if (ws.some((w) => w.id === id)) return ws.map((w) => (w.id === id ? { ...w, minimized: false, z: top + 1 } : w));
  const n = ws.length;
  const x = typeof window === "undefined" ? 80 : Math.max(16, window.innerWidth - Math.min(720, window.innerWidth - 32) - 24 - n * 32);
  const y = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerHeight - 600, 72 + n * 28));
  return [...ws, { id, minimized: false, x, y, z: top + 1 }];
}
