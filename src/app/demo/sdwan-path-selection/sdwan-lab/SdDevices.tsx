"use client";

import { clsx } from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CliVendor } from "@/lib/cli/types";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { ConsoleTerminal, EMPTY_SESSION, type ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import { QUALITIES, SD_CLASSES, SD_IP, TUN, sdClone, type Quality, type SdAction, type SdCap, type SdCfg, type SdClass, type SdDev, type SdNet, type SdTun } from "@/lib/sim-engine/scenarios/sdNet";
import { sdClientSet, sdCtrlSets, sdEdgeSets, sdIspSets, sdJunosConfig, type SdCliApi, type SdEdgeMode } from "./sdCli";
import { Paths, Policy } from "./SdPanels";

/**
 * SD-WAN Lab devices (drag, minimize to a tray; full screen on phones).
 *   BRANCH  Paths (measurements, SLA checks, eligibility) · Policy (per application: preference, SLA, fallback; the
 *           SLA class; recovery intervals — change any of it) · Console (Cisco edge or Junos SRX) · Controller
 *           (Cisco: the vSmart where the policy is written) · capture · log
 *   ISP-A/B the circuit's condition (the world: healthy, brownout, lossy, down), looking glass, capture
 *   CLIENT  send a call / the backup · shell · capture        HUB, APP  capture
 */
export interface SdDeskCtx {
  view: SdNet;
  act: (a: SdAction) => SdNet;
  vendor: CliVendor;
  setVendor: (v: CliVendor) => void;
  edge: SdEdgeMode;
  setEdge: (m: SdEdgeMode) => void;
  junosEdit: boolean;
  setJunosEdit: (b: boolean) => void;
  ctrlEdit: boolean;
  setCtrlEdit: (b: boolean) => void;
  cand: SdCfg;
  setCand: (c: SdCfg) => void;
  consoles: Record<string, ConsoleSession>;
  setConsoles: (u: (m: Record<string, ConsoleSession>) => Record<string, ConsoleSession>) => void;
  notes: boolean;
  setNotes: (b: boolean) => void;
  question?: CliQuestion;
  setQuestion: (q: CliQuestion | undefined) => void;
}
export interface SdWin {
  id: SdDev;
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
export const capPoints = (): string[] => ["CLIENT", "BRANCH", "ISP-A", "ISP-B", "HUB", "APP"];
const what = (c: SdCap) => (c.pkt.kind === "probe" ? `probe${c.pkt.reply ? " reply" : ""} ${c.pkt.tun}` : `${c.pkt.kind === "voice" ? "voice UDP 16400 · DSCP EF" : "backup TCP 873"}${c.pkt.tun ? ` · inside ${c.pkt.tun}` : ""}`);
export function CaptureView({ s, points, initial }: { s: SdNet; points: string[]; initial?: string }) {
  const [point, setPoint] = useState<string>(initial && points.includes(initial) ? initial : points[0]);
  const [onlyLast, setOnlyLast] = useState(true);
  const rows = s.captures.filter((c) => c.point === point && (!onlyLast || !s.last || c.run === s.last.id)).slice(-120);
  return (
    <div className="space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-pv-text-muted">
        {points.length > 1 && (
          <select value={point} onChange={(e) => setPoint(e.target.value)} className="rounded-md border border-pv-border bg-pv-bg px-2 py-0.5 text-[12px] text-pv-text" aria-label="Capture point">
            {points.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
        <label className="ml-auto flex items-center gap-1">
          <input type="checkbox" checked={onlyLast} onChange={(e) => setOnlyLast(e.target.checked)} /> last run only
        </label>
      </div>
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-pv-text-faint">Nothing crossed {point}{onlyLast ? " during the last run" : ""}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-[12px]">
            <thead className="text-[11px] text-pv-text-faint">
              <tr>
                <th className="px-1.5 py-1">#</th>
                <th className="px-1.5 py-1">dir</th>
                <th className="px-1.5 py-1">src → dst</th>
                <th className="px-1.5 py-1">what</th>
              </tr>
            </thead>
            <tbody className="pv-mono">
              {rows.map((c) => (
                <tr key={c.n} className={clsx("border-t border-pv-border/50", c.pkt.kind === "probe" ? "text-pv-violet" : c.pkt.kind === "voice" ? "text-[#fbbf24]" : "text-[#34d399]")}>
                  <td className="px-1.5 py-0.5">{c.n}</td>
                  <td className="px-1.5 py-0.5">{c.dir}</td>
                  <td className="px-1.5 py-0.5">
                    {c.pkt.src} → {c.pkt.dst}
                  </td>
                  <td className="px-1.5 py-0.5 font-sans">{what(c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11.5px] text-pv-text-muted">On the ISP links the packets travel inside the tunnel (encapsulation not drawn): the inner addresses are shown with the tunnel they use.</p>
    </div>
  );
}
function cliApi(c: SdDeskCtx, key: string): SdCliApi {
  return { view: c.view, act: c.act, edge: c.edge, setEdge: c.setEdge, junosEdit: c.junosEdit, setJunosEdit: c.setJunosEdit, ctrlEdit: c.ctrlEdit, setCtrlEdit: c.setCtrlEdit, cand: c.cand, setCand: c.setCand, ask: c.setQuestion, history: c.consoles[key]?.history ?? [] };
}
export function DevConsole({ c, dev, ctrl, className }: { c: SdDeskCtx; dev: SdDev; ctrl?: boolean; className?: string }) {
  const host = dev === "CLIENT";
  const os = host ? "linux" : ctrl ? "ios" : c.vendor === "cisco" ? "ios" : "junos";
  const key = `${dev}:${ctrl ? "ctrl" : os}`;
  const api = cliApi(c, key);
  const sets = host ? { cisco: sdClientSet(api), juniper: sdClientSet(api) } : ctrl ? sdCtrlSets(api) : dev === "BRANCH" ? sdEdgeSets(api) : sdIspSets(dev as "ISP-A" | "ISP-B", api);
  return <ConsoleTerminal key={key} sets={sets} vendor={ctrl ? "cisco" : c.vendor} setVendor={host || ctrl ? undefined : c.setVendor} os={os} host={ctrl ? "CTRL" : dev} session={c.consoles[key] ?? EMPTY_SESSION} setSession={(u) => c.setConsoles((m) => ({ ...m, [key]: u(m[key] ?? EMPTY_SESSION) }))} notes={c.notes} setNotes={c.setNotes} question={c.question?.node === (ctrl ? "CTRL" : dev) ? c.question : undefined} pipeCtx={dev === "BRANCH" && !ctrl ? { config: sdJunosConfig(api), rollbacks: 1 } : undefined} className={className ?? "h-[min(440px,58vh)]"} />;
}
const PREF_OPTS: SdTun[][] = [["TUN-A", "TUN-B"], ["TUN-B", "TUN-A"], ["TUN-A"], ["TUN-B"]];
function PolicyEditor({ c }: { c: SdDeskCtx }) {
  const s = c.view;
  const cfg = s.cfg;
  const set = (f: (x: SdCfg) => void, text: string) => {
    const n = sdClone(cfg);
    f(n);
    c.act({ type: "cfg", cfg: n, text: `${c.vendor === "cisco" ? "CONTROLLER" : "BRANCH"}: ${text}` });
  };
  const row = (k: string, el: ReactNode) => (
    <label className="flex flex-wrap items-center justify-between gap-2 border-b border-pv-border/50 py-1 text-[12.5px] text-pv-text-muted">
      {k}
      {el}
    </label>
  );
  return (
    <div className="space-y-3 p-3">
      <p className="text-[12.5px] text-pv-text-muted">{c.vendor === "cisco" ? "Catalyst SD-WAN: this policy lives on the controller and is pushed to the edge — editing it here is editing it there." : "Junos SRX: the policy lives on the branch itself (APBR, SLA rule, routing instances)."}</p>
      {SD_CLASSES.map((k: SdClass) => (
        <div key={k} className="rounded-lg border border-pv-border/60 p-2">
          <p className={clsx("text-[12.5px] font-bold", k === "VOICE" ? "text-[#fbbf24]" : "text-[#34d399]")}>{k}</p>
          {row(
            "path preference",
            <select aria-label={`${k} preference`} className={sel} value={cfg.pref[k].join(">")} onChange={(e) => set((x) => (x.pref[k] = e.target.value.split(">") as SdTun[]), `${k} preference ${e.target.value}`)}>
              {PREF_OPTS.map((o) => (
                <option key={o.join()} value={o.join(">")}>
                  {o.map((t) => `${t} (${TUN[t].color})`).join(" > ")}
                </option>
              ))}
            </select>,
          )}
          {k === "VOICE" && row("SLA required (only SLA-eligible paths)", <input type="checkbox" aria-label="VOICE SLA required" checked={cfg.slaReq.VOICE} onChange={(e) => set((x) => (x.slaReq.VOICE = e.target.checked), `VOICE SLA ${e.target.checked ? "required" : "not required"}`)} />)}
          {k === "VOICE" && row("no compliant path → best path (unchecked: drop)", <input type="checkbox" aria-label="VOICE fallback" checked={cfg.fallback.VOICE} onChange={(e) => set((x) => (x.fallback.VOICE = e.target.checked), `VOICE ${e.target.checked ? "fallback-to-best-path" : "strict"}`)} />)}
        </div>
      ))}
      <div className="rounded-lg border border-pv-border/60 p-2">
        <p className="text-[12.5px] font-bold text-pv-text">VOICE SLA class</p>
        {row(
          "latency ≤ (ms)",
          <select aria-label="SLA latency" className={sel} value={cfg.sla.rtt} onChange={(e) => set((x) => (x.sla.rtt = +e.target.value), `SLA latency ${e.target.value} ms`)}>
            {[...new Set([20, 50, 100, 150, 250, cfg.sla.rtt])].sort((a, b) => a - b).map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>,
        )}
        {row(
          "jitter ≤ (ms)",
          <select aria-label="SLA jitter" className={sel} value={cfg.sla.jitter} onChange={(e) => set((x) => (x.sla.jitter = +e.target.value), `SLA jitter ${e.target.value} ms`)}>
            {[...new Set([10, 30, 60, cfg.sla.jitter])].sort((a, b) => a - b).map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>,
        )}
        {row(
          "loss ≤ (%)",
          <select aria-label="SLA loss" className={sel} value={cfg.sla.loss} onChange={(e) => set((x) => (x.sla.loss = +e.target.value), `SLA loss ${e.target.value}%`)}>
            {[...new Set([0.5, 1, 3, 5, cfg.sla.loss])].sort((a, b) => a - b).map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>,
        )}
        {row(
          "recovery: passing intervals before reuse",
          <select aria-label="Recovery intervals" className={sel} value={cfg.hold} onChange={(e) => set((x) => (x.hold = +e.target.value), `recovery ${e.target.value} intervals`)}>
            {[1, 2, 3, 4, 5].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>,
        )}
      </div>
    </div>
  );
}
function BranchUI({ c }: { c: SdDeskCtx }) {
  const cisco = c.vendor === "cisco";
  const [tab, setTab] = useState<"paths" | "policy" | "term" | "ctrl" | "cap" | "log">("paths");
  const s = c.view;
  const tabs: [typeof tab, string][] = [["paths", "Paths"], ["policy", "Policy"], ["term", cisco ? "Edge console" : "Console"], ...(cisco ? [["ctrl", "Controller (vSmart)"] as [typeof tab, string]] : []), ["cap", "Capture"], ["log", "Log"]];
  const cur = !cisco && tab === "ctrl" ? "term" : tab;
  return (
    <>
      <Tabs tabs={tabs} cur={cur} set={setTab} />
      {cur === "paths" && (
        <div className="space-y-2 p-3">
          <Paths s={s} />
          <Policy s={s} />
        </div>
      )}
      {cur === "policy" && <PolicyEditor c={c} />}
      {cur === "term" && <DevConsole c={c} dev="BRANCH" />}
      {cur === "ctrl" && <DevConsole c={c} dev="BRANCH" ctrl />}
      {cur === "cap" && <CaptureView s={s} points={["BRANCH"]} />}
      {cur === "log" && (
        <div className="space-y-1 p-3 text-[12px]">
          {s.events.length === 0 ? (
            <p className="text-pv-text-faint">No path changes yet.</p>
          ) : (
            s.events.slice(-40).map((e, k) => (
              <p key={k} className={clsx("pv-mono", e.tone === "up" ? "text-pv-success" : e.tone === "down" ? "text-pv-danger" : "text-pv-text-muted")}>
                t={e.clock - 50400}s · {e.text}
              </p>
            ))
          )}
        </div>
      )}
    </>
  );
}
function IspUI({ c, isp }: { c: SdDeskCtx; isp: "ISP-A" | "ISP-B" }) {
  const [tab, setTab] = useState<"status" | "term" | "cap">("status");
  const t: SdTun = isp === "ISP-A" ? "TUN-A" : "TUN-B";
  return (
    <>
      <Tabs
        tabs={[
          ["status", "Circuit"],
          ["term", "Looking glass"],
          ["cap", "Capture"],
        ]}
        cur={tab}
        set={setTab}
      />
      {tab === "status" && (
        <div className="space-y-2 p-3">
          <Kv k="carries" v={`${t} (${TUN[t].color}) · ${TUN[t].local} → ${TUN[t].remote}`} />
          <label className="flex items-center justify-between gap-2 text-[12.5px] text-pv-text-muted">
            condition (the world, not your configuration)
            <select aria-label={`${isp} condition`} className={sel} value={c.view.paths[t].quality} onChange={(e) => c.act({ type: "world", tun: t, q: e.target.value as Quality })}>
              {QUALITIES.map((q) => (
                <option key={q}>{q}</option>
              ))}
            </select>
          </label>
          <p className="text-[11.5px] text-pv-text-muted">The edge notices a change only at its next measurement interval.</p>
        </div>
      )}
      {tab === "term" && <DevConsole c={c} dev={isp} />}
      {tab === "cap" && <CaptureView s={c.view} points={[isp]} />}
    </>
  );
}
function ClientUI({ c }: { c: SdDeskCtx }) {
  const [tab, setTab] = useState<"send" | "shell" | "cap">("send");
  const s = c.view;
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
          <Kv k="IPv4 · gateway" v={`${SD_IP.client} · ${SD_IP.branchLan}`} />
          <div className="flex flex-wrap gap-1">
            <button type="button" className={btn} onClick={() => c.act({ type: "traffic", kinds: ["VOICE"] })}>
              Place a call (voice)
            </button>
            <button type="button" className={btn} onClick={() => c.act({ type: "traffic", kinds: ["BULK"] })}>
              Run the backup (bulk)
            </button>
          </div>
          {s.last?.kind === "traffic" && <p className={clsx("text-[12px]", s.last.results[0].delivered ? "text-pv-success" : "text-pv-danger")}>{s.last.results[0].delivered ? `${s.last.results[0].kind} via ${s.last.results[0].tun} — ${s.last.results[0].quality}` : s.last.results[0].fail}</p>}
        </div>
      )}
      {tab === "shell" && <DevConsole c={c} dev="CLIENT" />}
      {tab === "cap" && <CaptureView s={s} points={["CLIENT"]} />}
    </>
  );
}
function CapOnlyUI({ c, dev }: { c: SdDeskCtx; dev: SdDev }) {
  return <CaptureView s={c.view} points={[dev]} />;
}

function Win({ w, c, narrow, focused, onFocus, onMove, onMin, onClose }: { w: SdWin; c: SdDeskCtx; narrow: boolean; focused: boolean; onFocus: () => void; onMove: (x: number, y: number) => void; onMin: () => void; onClose: () => void }) {
  const drag = useRef<{ dx: number; dy: number } | undefined>(undefined);
  const tone = w.id === "BRANCH" || w.id === "HUB" ? "#f59e0b" : w.id.startsWith("ISP") ? "#a78bfa" : "#34d399";
  return (
    <section role="dialog" aria-label={`${w.id} window`} onPointerDown={onFocus} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onMin(); } }} className={clsx("flex flex-col overflow-hidden border bg-pv-bg shadow-2xl", narrow ? "fixed inset-0 rounded-none" : "fixed rounded-xl", focused ? "border-pv-cyan/60" : "border-pv-border", w.minimized && "hidden")} style={narrow ? { zIndex: 100 + w.z } : { left: w.x, top: w.y, width: "min(900px, calc(100vw - 32px))", height: "min(640px, calc(100vh - 96px))", zIndex: 100 + w.z, resize: "both" }}>
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
          {w.id === "BRANCH" || w.id === "HUB" ? "R" : w.id.startsWith("ISP") ? "☁" : "💻"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-bold text-pv-text">
            {w.id}
          </p>
          <p className="truncate text-[11px] text-pv-text-faint">{w.id === "BRANCH" ? `branch edge · ${c.vendor === "cisco" ? "Cisco Catalyst SD-WAN" : "Junos SRX"} view` : w.id === "HUB" ? "hub edge (the other end of both tunnels)" : w.id.startsWith("ISP") ? "provider circuit · read-only" : w.id === "CLIENT" ? `${SD_IP.client} · Linux` : `${SD_IP.app} · application server`}</p>
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
      <div className="min-h-0 flex-1 overflow-y-auto">{w.id === "BRANCH" ? <BranchUI c={c} /> : w.id === "ISP-A" || w.id === "ISP-B" ? <IspUI c={c} isp={w.id} /> : w.id === "CLIENT" ? <ClientUI c={c} /> : <CapOnlyUI c={c} dev={w.id} />}</div>
    </section>
  );
}
export function SdDesk({ windows, setWindows, focus, setFocus, ctx }: { windows: SdWin[]; setWindows: (u: (w: SdWin[]) => SdWin[]) => void; focus?: SdDev; setFocus: (n: SdDev | undefined) => void; ctx: SdDeskCtx }) {
  const narrow = useNarrow();
  if (typeof document === "undefined" || !windows.length) return null;
  const top = Math.max(0, ...windows.map((w) => w.z));
  const raise = (id: SdDev) => {
    setFocus(id);
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, z: top + 1, minimized: false } : w)));
  };
  const minimize = (id: SdDev) => (setWindows((ws) => ws.map((v) => (v.id === id ? { ...v, minimized: true } : v))), setFocus(undefined));
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
export function openSdWindow(ws: SdWin[], id: SdDev): SdWin[] {
  const top = Math.max(0, ...ws.map((w) => w.z));
  if (ws.some((w) => w.id === id)) return ws.map((w) => (w.id === id ? { ...w, minimized: false, z: top + 1 } : w));
  const n = ws.length;
  const x = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerWidth - 920, 40 + n * 36));
  const y = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerHeight - 660, 90 + n * 30));
  return [...ws, { id, minimized: false, x, y, z: top + 1 }];
}
