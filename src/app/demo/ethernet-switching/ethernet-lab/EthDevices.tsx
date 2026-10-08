"use client";

import { clsx } from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CliVendor } from "@/lib/cli/types";
import { DESK_PORTS, ETH_MAC, SW1_PORTS, type EthDevice, type EthHost, type EthSwitch } from "@/lib/sim-engine/scenarios/ethernetSwitching";
import { ETH_HOSTS, hostLink, nicMacOf, portCable, portNeighbor, type EthLabAction, type EthLabState } from "@/lib/sim-engine/scenarios/ethernetLab";
import { ConsoleTerminal, EMPTY_SESSION, type ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { CaptureList, Faceplate, MacTable, portLabel } from "./EthVisuals";
import { CISCO_IF, ethJunosConfig, ethPortName, ethSw1CliSets, type EthCliApi } from "./ethLabCli";

/**
 * The Ethernet Lab's devices, Packet Tracer style: clicking a device on the topology opens THAT device in its own
 * window. SW1 (managed) has its ports and counters, its MAC table, its console (Cisco IOS or Junos) and a capture on
 * any port. DESK-SW is unmanaged: its lights and, as a simulation view, its table and port captures — no console.
 * A host has its network card (MAC, link), its cable, a way to send frames and a capture on eth0. Everything is read
 * from, and every change goes through, the same lab state the topology animates.
 */

export interface EthWin {
  id: EthDevice;
  minimized: boolean;
  x: number;
  y: number;
  z: number;
}
const KIND: Record<EthDevice, { kind: string; icon: string; tone: string; model: string }> = {
  SW1: { kind: "Switch", icon: "⇄", tone: "#22d3ee", model: "Managed access switch · 4 ports · console: Cisco IOS or Junos" },
  "DESK-SW": { kind: "Switch", icon: "⇄", tone: "#94a3b8", model: "Unmanaged desk switch · 2 ports · no console" },
  "HOST-A": { kind: "PC", icon: "💻", tone: "#34d399", model: `NIC ${ETH_MAC["HOST-A"]}` },
  "HOST-B": { kind: "PC", icon: "💻", tone: "#34d399", model: `NIC ${ETH_MAC["HOST-B"]} · moves between desks` },
  "HOST-C": { kind: "PC", icon: "💻", tone: "#34d399", model: `NIC ${ETH_MAC["HOST-C"]}` },
};

export interface EthDeskCtx {
  lab: EthLabState;
  act: (a: EthLabAction) => void;
  busy: boolean;
  vendor: CliVendor;
  setVendor: (v: CliVendor) => void;
  cli: Omit<EthCliApi, "lab" | "act" | "history" | "ask">;
  consoles: Record<string, ConsoleSession>;
  setConsoles: (u: (m: Record<string, ConsoleSession>) => Record<string, ConsoleSession>) => void;
  question?: CliQuestion;
  setQuestion: (q: CliQuestion | undefined) => void;
  notes: boolean;
  setNotes: (b: boolean) => void;
  onCommand?: (id: string, line: string) => void;
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
const Btn = ({ children, onClick, disabled, tone }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: "warn" }) => (
  <button type="button" onClick={onClick} disabled={disabled} className={clsx("rounded-full border px-3 py-1 text-[12px] font-semibold disabled:opacity-40", tone === "warn" ? "border-pv-warning/60 text-pv-warning hover:bg-pv-warning/10" : "border-pv-border text-pv-text hover:border-pv-cyan/60")}>
    {children}
  </button>
);

/** Where a capture can be taken on a switch: one of its ports. */
function PortCapture({ c, sw }: { c: EthDeskCtx; sw: EthSwitch }) {
  const ports = sw === "SW1" ? [...SW1_PORTS] : [...DESK_PORTS];
  const [port, setPort] = useState<string>(ports[0]);
  return (
    <div className="space-y-2">
      <Note>A capture on a port shows every frame that crossed it, in or out, and what {sw} did with the ones that arrived. Captures start when the lab (or a ticket) starts.</Note>
      <div className="flex flex-wrap gap-1">
        {ports.map((p) => (
          <button key={p} type="button" aria-pressed={port === p} onClick={() => setPort(p)} className={clsx("rounded-md border px-2 py-0.5 pv-mono text-[11.5px]", port === p ? "border-pv-cyan bg-pv-cyan/15 text-pv-text" : "border-pv-border text-pv-text-muted")}>
            {portLabel(sw, p, c.vendor)} {portCable(c.lab, sw, p) ? `· ${portCable(c.lab, sw, p)}` : ""}
          </button>
        ))}
      </div>
      <CaptureList lab={c.lab} dev={sw} iface={port} vendor={c.vendor} max={80} />
    </div>
  );
}

function PortTable({ c, sw }: { c: EthDeskCtx; sw: EthSwitch }) {
  const ports = sw === "SW1" ? [...SW1_PORTS] : [...DESK_PORTS];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[460px] text-left text-[12px]">
        <thead className="text-[10.5px] text-pv-text-faint">
          <tr>
            <th className="font-normal">port</th>
            <th className="font-normal">cable to</th>
            <th className="font-normal">link</th>
            <th className="font-normal">frames in / out</th>
            <th className="font-normal">broadcasts in / out</th>
          </tr>
        </thead>
        <tbody className="pv-mono">
          {ports.map((p) => {
            const k = c.lab.counters[`${sw} ${p}`];
            const shut = sw === "SW1" && c.lab.cfg.shut.includes(p);
            const up = !!portNeighbor(c.lab, sw, p);
            return (
              <tr key={p} className="border-t border-pv-border/50">
                <td className="py-0.5 pr-2 text-pv-text">{portLabel(sw, p, c.vendor)}</td>
                <td className="pr-2 font-sans text-pv-text-muted">{portCable(c.lab, sw, p) ?? "—"}</td>
                <td className={clsx("pr-2", shut ? "text-pv-warning" : up ? "text-pv-success" : "text-pv-text-faint")}>{shut ? "admin down" : up ? "up" : "down"}</td>
                <td className="pr-2">
                  {k?.inFrames ?? 0} / {k?.outFrames ?? 0}
                </td>
                <td>
                  {k?.inBcast ?? 0} / {k?.outBcast ?? 0}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Sw1UI({ c }: { c: EthDeskCtx }) {
  const [tab, setTab] = useState<"ports" | "table" | "cli" | "capture">("cli");
  const os = c.vendor === "cisco" ? "ios" : "junos";
  const key = `SW1:${os}`;
  const api: EthCliApi = { ...c.cli, lab: c.lab, act: c.act, history: c.consoles[key]?.history ?? [], ask: c.setQuestion };
  return (
    <>
      <Tabs
        tabs={[
          ["ports", "Ports"],
          ["table", "MAC table"],
          ["cli", "Console"],
          ["capture", "Capture"],
        ]}
        cur={tab}
        set={setTab}
      />
      <div className="space-y-2 p-3">
        {tab === "ports" && (
          <>
            <Faceplate lab={c.lab} vendor={c.vendor} tx={c.lab.last?.type === "send" ? c.lab.tx : undefined} counters />
            <PortTable c={c} sw="SW1" />
            <Note>
              The same ports, as each OS names them: {SW1_PORTS.map((p) => `${CISCO_IF[p]} = ${p}`).join(" · ")}. Counters are what <span className="pv-mono">show interfaces</span> prints.
            </Note>
          </>
        )}
        {tab === "table" && (
          <>
            <MacTable lab={c.lab} sw="SW1" vendor={c.vendor} tx={c.lab.last?.type === "send" ? c.lab.tx : undefined} />
            <Note>{c.vendor === "cisco" ? "show mac address-table" : "show ethernet-switching table"} prints this same table. Learned entries come from the SOURCE MAC of arriving frames; static ones come from the configuration.</Note>
          </>
        )}
        {tab === "cli" && (
          <ConsoleTerminal
            key={key}
            sets={ethSw1CliSets(api)}
            vendor={c.vendor}
            setVendor={c.setVendor}
            os={os}
            host="SW1"
            session={c.consoles[key] ?? EMPTY_SESSION}
            setSession={(u) => c.setConsoles((m) => ({ ...m, [key]: u(m[key] ?? EMPTY_SESSION) }))}
            onExecuted={(id, ok, line) => ok && c.onCommand?.(id, line)}
            notes={c.notes}
            setNotes={c.setNotes}
            question={c.question}
            pipeCtx={{ config: ethJunosConfig(c.cli), rollbacks: c.cli.hist.length }}
            className="h-[min(420px,55vh)]"
          />
        )}
        {tab === "capture" && <PortCapture c={c} sw="SW1" />}
      </div>
    </>
  );
}

function DeskUI({ c }: { c: EthDeskCtx }) {
  const [tab, setTab] = useState<"ports" | "table" | "capture">("ports");
  return (
    <>
      <Tabs
        tabs={[
          ["ports", "Ports"],
          ["table", "Table (simulation)"],
          ["capture", "Capture"],
        ]}
        cur={tab}
        set={setTab}
      />
      <div className="space-y-2 p-3">
        <Note>An unmanaged switch: no console port, no IP address, no configuration. It learns and forwards exactly like SW1, but nobody can log in to ask it what it knows — the table and captures here are the simulator showing you its insides.</Note>
        {tab === "ports" && (
          <>
            <Faceplate lab={c.lab} sw="DESK-SW" vendor={c.vendor} tx={c.lab.last?.type === "send" ? c.lab.tx : undefined} counters />
            <PortTable c={c} sw="DESK-SW" />
            <Note>Port 1 is the cable to SW1 {ethPortName(c.vendor, "ge-0/0/4")}. Port 2 is the hot desk.</Note>
          </>
        )}
        {tab === "table" && <MacTable lab={c.lab} sw="DESK-SW" vendor={c.vendor} tx={c.lab.last?.type === "send" ? c.lab.tx : undefined} />}
        {tab === "capture" && <PortCapture c={c} sw="DESK-SW" />}
      </div>
    </>
  );
}

function HostUI({ c, host }: { c: EthDeskCtx; host: EthHost }) {
  const [tab, setTab] = useState<"nic" | "send" | "capture">("nic");
  const l = hostLink(c.lab, host);
  const mac = nicMacOf(c.lab, host);
  const where = l.sw === "SW1" ? `SW1 ${ethPortName(c.vendor, l.port)}` : `DESK-SW ${l.port}`;
  return (
    <>
      <Tabs
        tabs={[
          ["nic", "Network card"],
          ["send", "Send a frame"],
          ["capture", "Capture eth0"],
        ]}
        cur={tab}
        set={setTab}
      />
      <div className="space-y-2.5 p-3">
        {tab === "nic" && (
          <>
            <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-y-1 text-[12.5px]">
              <span className="text-pv-text-muted">Interface</span>
              <span className="pv-mono text-pv-text">eth0</span>
              <span className="text-pv-text-muted">MAC address</span>
              <span className="pv-mono text-pv-text">
                {mac} {mac !== ETH_MAC[host] && <span className="font-sans text-pv-warning">(changed: burned-in is {ETH_MAC[host]})</span>}
              </span>
              <span className="text-pv-text-muted">Cable</span>
              <span className="text-pv-text">{l.plugged ? `plugged into ${where}` : `unplugged (its other end is ${where})`}</span>
              <span className="text-pv-text-muted">Link</span>
              <span className={clsx(l.up ? "text-pv-success" : "text-pv-danger")}>{l.up ? "up" : l.shut ? "down: the switch port is shut down" : "down: no cable"}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Btn onClick={() => c.act({ type: "cable", host, plugged: !l.plugged })} disabled={c.busy}>
                {l.plugged ? "Unplug the cable" : "Plug the cable back in"}
              </Btn>
              {host === "HOST-B" && (
                <Btn onClick={() => c.act({ type: "move-b", to: c.lab.net.hostB === "SW1 ge-0/0/2" ? "desk" : "sw1" })} disabled={c.busy}>
                  {c.lab.net.hostB === "SW1 ge-0/0/2" ? "Move to the hot desk (DESK-SW port 2)" : `Move back to SW1 ${ethPortName(c.vendor, "ge-0/0/2")}`}
                </Btn>
              )}
            </div>
            <div className="space-y-1 rounded-lg border border-pv-border p-2">
              <p className="text-[12px] font-semibold text-pv-text">MAC address setting</p>
              <Note>Most network cards let software override the burned-in address. The card then sends from that MAC and keeps frames addressed to it.</Note>
              <div className="flex flex-wrap gap-1">
                {[undefined, ...ETH_HOSTS.filter((h) => h !== host).map((h) => ETH_MAC[h])].map((m) => (
                  <button
                    key={m ?? "own"}
                    type="button"
                    aria-pressed={(m ?? ETH_MAC[host]) === mac}
                    disabled={c.busy}
                    onClick={() => c.act({ type: "nic-mac", host, mac: m })}
                    className={clsx("rounded-md border px-2 py-0.5 text-[11.5px]", (m ?? ETH_MAC[host]) === mac ? "border-pv-cyan bg-pv-cyan/15 text-pv-text" : "border-pv-border text-pv-text-muted hover:text-pv-text")}
                  >
                    {m ? <span className="pv-mono">{m}</span> : "burned-in"}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        {tab === "send" && (
          <>
            <Note>Sends one frame out of eth0, from this card&apos;s MAC ({mac}). A frame to a host carries an IPv4 payload; a broadcast here is an ARP request.</Note>
            <div className="flex flex-wrap gap-1.5">
              {[...ETH_HOSTS.filter((h) => h !== host), "broadcast" as const].map((d) => (
                <Btn key={d} onClick={() => c.act({ type: "send", src: host, dst: d })} disabled={c.busy}>
                  → {d === "broadcast" ? "broadcast (FF:FF:FF:FF:FF:FF)" : d}
                </Btn>
              ))}
            </div>
            {!l.up && <p className="text-[12px] text-pv-warning">No link: a frame sent now goes nowhere.</p>}
          </>
        )}
        {tab === "capture" && (
          <>
            <Note>Like running a packet capture on this PC: every frame its card sent, and every frame that reached it — kept or discarded by the NIC.</Note>
            <CaptureList lab={c.lab} dev={host} iface="eth0" vendor={c.vendor} max={80} />
          </>
        )}
      </div>
    </>
  );
}

function Win({ w, c, narrow, focused, onFocus, onMove, onMin, onClose }: { w: EthWin; c: EthDeskCtx; narrow: boolean; focused: boolean; onFocus: () => void; onMove: (x: number, y: number) => void; onMin: () => void; onClose: () => void }) {
  const k = KIND[w.id];
  const drag = useRef<{ dx: number; dy: number } | undefined>(undefined);
  return (
    <section
      role="dialog"
      aria-label={`${w.id} ${k.kind.toLowerCase()} window`}
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
            {w.id} <span className="font-normal text-pv-text-muted">· {k.kind}</span>
          </p>
          <p className="truncate text-[11px] text-pv-text-faint">{k.model}</p>
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
      <div className="min-h-0 flex-1 overflow-y-auto">{w.id === "SW1" ? <Sw1UI c={c} /> : w.id === "DESK-SW" ? <DeskUI c={c} /> : <HostUI c={c} host={w.id} />}</div>
    </section>
  );
}

/** Every open device window, plus the tray of open devices. Portalled above the whole lab. */
export function EthDesk({ windows, setWindows, focus, setFocus, ctx }: { windows: EthWin[]; setWindows: (u: (w: EthWin[]) => EthWin[]) => void; focus?: EthDevice; setFocus: (n: EthDevice | undefined) => void; ctx: EthDeskCtx }) {
  const narrow = useNarrow();
  if (typeof document === "undefined" || !windows.length) return null;
  const top = Math.max(0, ...windows.map((w) => w.z));
  const raise = (id: EthDevice) => {
    setFocus(id);
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, z: top + 1, minimized: false } : w)));
  };
  const minimize = (id: EthDevice) => (setWindows((ws) => ws.map((v) => (v.id === id ? { ...v, minimized: true } : v))), setFocus(undefined));
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
            {w.id}
            {w.minimized && <span className="text-[10px] text-pv-text-faint">(min)</span>}
          </button>
        ))}
      </nav>
    </>,
    document.body,
  );
}

export function openEthWindow(ws: EthWin[], id: EthDevice): EthWin[] {
  const top = Math.max(0, ...ws.map((w) => w.z));
  if (ws.some((w) => w.id === id)) return ws.map((w) => (w.id === id ? { ...w, minimized: false, z: top + 1 } : w));
  const n = ws.length;
  const x = typeof window === "undefined" ? 80 : Math.max(16, window.innerWidth - Math.min(720, window.innerWidth - 32) - 24 - n * 32);
  const y = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerHeight - 600, 72 + n * 28));
  return [...ws, { id, minimized: false, x, y, z: top + 1 }];
}
