"use client";

import { clsx } from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CliCommandSet, CliVendor } from "@/lib/cli/types";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { ConsoleTerminal, EMPTY_SESSION, type ConsoleOs, type ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import type { PipeCtx } from "@/app/demo/dhcp-dns/dhcp-lab/cliPipes";

/**
 * Device windows for the Service Provider labs: click a router on the topology, it opens in its own window (drag,
 * minimize, raise; full screen on phones with a "← Network" button), a dock lists the open ones. The lesson renders
 * what is inside each window; this file only manages the windows and the consoles.
 */

export interface SpWin {
  id: string;
  minimized: boolean;
  x: number;
  y: number;
  z: number;
}
export interface SpDeskDevice {
  label: string;
  icon: string;
  tone: string;
  sub: string;
}

export function useNarrow() {
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

export function openSpWindow(ws: SpWin[], id: string): SpWin[] {
  const top = Math.max(0, ...ws.map((w) => w.z));
  if (ws.some((w) => w.id === id)) return ws.map((w) => (w.id === id ? { ...w, minimized: false, z: top + 1 } : w));
  const n = ws.length;
  const x = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerWidth - 860, 40 + n * 36));
  const y = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerHeight - 680, 80 + n * 30));
  return [...ws, { id, minimized: false, x, y, z: top + 1 }];
}

function Win({ w, dev, narrow, focused, onFocus, onMove, onMin, onClose, children }: { w: SpWin; dev: SpDeskDevice; narrow: boolean; focused: boolean; onFocus: () => void; onMove: (x: number, y: number) => void; onMin: () => void; onClose: () => void; children: ReactNode }) {
  const drag = useRef<{ dx: number; dy: number } | undefined>(undefined);
  return (
    <section
      role="dialog"
      aria-label={`${dev.label} window`}
      onPointerDown={onFocus}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onMin();
        }
      }}
      className={clsx("flex flex-col overflow-hidden border bg-pv-bg shadow-2xl", narrow ? "fixed inset-0 rounded-none" : "fixed rounded-xl", focused ? "border-pv-cyan/60" : "border-pv-border", w.minimized && "hidden")}
      style={narrow ? { zIndex: 100 + w.z } : { left: w.x, top: w.y, width: "min(860px, calc(100vw - 32px))", height: "min(660px, calc(100vh - 96px))", zIndex: 100 + w.z, resize: "both" }}
    >
      <header
        className={clsx("flex select-none items-center gap-2 border-b border-pv-border px-3 py-2", !narrow && "cursor-move")}
        style={{ background: `linear-gradient(90deg, ${dev.tone}22, transparent)` }}
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
        <span className="flex h-7 min-w-7 items-center justify-center rounded-lg border px-1 text-[11px] font-bold" style={{ borderColor: dev.tone, color: dev.tone }} aria-hidden>
          {dev.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-bold text-pv-text">{dev.label}</p>
          <p className="truncate text-[11px] text-pv-text-faint">{dev.sub}</p>
        </div>
        {!narrow && (
          <button type="button" onClick={onMin} aria-label={`Minimize ${dev.label}`} className="rounded-md px-2 text-[14px] text-pv-text-faint hover:bg-white/10 hover:text-pv-text">
            –
          </button>
        )}
        <button type="button" onClick={onClose} aria-label={`Close ${dev.label}`} className="rounded-md px-2 text-[14px] text-pv-text-faint hover:bg-pv-danger/20 hover:text-pv-text">
          ✕
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

export function SpDesk({ windows, setWindows, focus, setFocus, device, render }: { windows: SpWin[]; setWindows: (u: (w: SpWin[]) => SpWin[]) => void; focus?: string; setFocus: (n: string | undefined) => void; device: (id: string) => SpDeskDevice; render: (id: string) => ReactNode }) {
  const narrow = useNarrow();
  if (typeof document === "undefined" || !windows.length) return null;
  const top = Math.max(0, ...windows.map((w) => w.z));
  const raise = (id: string) => {
    setFocus(id);
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, z: top + 1, minimized: false } : w)));
  };
  const minimize = (id: string) => (setWindows((ws) => ws.map((v) => (v.id === id ? { ...v, minimized: true } : v))), setFocus(undefined));
  return createPortal(
    <>
      {windows.map((w) => (
        <Win key={w.id} w={w} dev={device(w.id)} narrow={narrow} focused={focus === w.id} onFocus={() => focus !== w.id && raise(w.id)} onMove={(x, y) => setWindows((ws) => ws.map((v) => (v.id === w.id ? { ...v, x, y } : v)))} onMin={() => minimize(w.id)} onClose={() => (setWindows((ws) => ws.filter((v) => v.id !== w.id)), setFocus(undefined))}>
          {render(w.id)}
        </Win>
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

/** What a console needs from the workspace (sessions survive closing and reopening a window). */
export interface SpConsoleCtx {
  sessions: Record<string, ConsoleSession>;
  setSessions: (u: (m: Record<string, ConsoleSession>) => Record<string, ConsoleSession>) => void;
  notes: boolean;
  setNotes: (b: boolean) => void;
  question?: CliQuestion;
}
export function SpConsole({ c, sets, os, host, vendor, setVendor, pipeCtx, className }: { c: SpConsoleCtx; sets: Partial<Record<CliVendor, CliCommandSet>>; os: ConsoleOs; host: string; vendor: CliVendor; setVendor?: (v: CliVendor) => void; pipeCtx?: Pick<PipeCtx, "config" | "rollbacks">; className?: string }) {
  const key = `${host}:${os}`;
  return (
    <ConsoleTerminal
      key={key}
      sets={sets}
      vendor={vendor}
      setVendor={setVendor}
      os={os}
      host={host}
      session={c.sessions[key] ?? EMPTY_SESSION}
      setSession={(u) => c.setSessions((m) => ({ ...m, [key]: u(m[key] ?? EMPTY_SESSION) }))}
      notes={c.notes}
      setNotes={c.setNotes}
      question={c.question?.node === host ? c.question : undefined}
      pipeCtx={pipeCtx}
      vendorLabels={{ cisco: "IOS XR" }}
      className={className ?? "h-[min(460px,60vh)]"}
    />
  );
}
