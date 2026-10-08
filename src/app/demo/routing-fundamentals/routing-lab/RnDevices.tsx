"use client";

import { clsx } from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CliVendor } from "@/lib/cli/types";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { ConsoleTerminal, EMPTY_SESSION, type ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import { RN_HOSTS, RN_IFS, RN_IF_SEG, RN_ROUTERS, RN_SEG_NAME, isRouter, kindName, netOf, rnClone, rnIfStatus, rnLookup, rnName, rnPeerOf, type RnAction, type RnCap, type RnDev, type RnHost, type RnIf, type RnRouter, type RnRouterCfg, type RnSnap, type RnState } from "@/lib/sim-engine/scenarios/routeNet";
import { ifName, rnHostSet, rnJunosConfig, rnRouterSets, type RnCliApi, type RnIosMode } from "./rnCli";
import { RouteTable } from "./RnPanels";

/**
 * Routing Lab devices, Packet Tracer style (drag, minimize to a tray, resize; full screen on phones).
 *   Routers: interfaces (address, state, what is on the other side, counters; enable / disable), the routing table
 *            (installed and not-installed routes), its ARP cache, a Cisco/Junos console, a capture on any interface.
 *   Hosts:   address / mask / gateway and the host's own two routes, a Linux terminal, a capture of its NIC.
 * Every number is read from the lab state; every change goes through the model.
 */

export interface RnDeskCtx {
  view: RnState;
  snap?: RnSnap;
  act: (a: RnAction) => RnState;
  vendor: CliVendor;
  setVendor: (v: CliVendor) => void;
  ios: Record<RnRouter, RnIosMode>;
  setIos: (r: RnRouter, m: RnIosMode) => void;
  junosEdit: Record<RnRouter, boolean>;
  setJunosEdit: (r: RnRouter, b: boolean) => void;
  cand: Record<RnRouter, RnRouterCfg>;
  setCand: (r: RnRouter, c: RnRouterCfg) => void;
  consoles: Record<string, ConsoleSession>;
  setConsoles: (u: (m: Record<string, ConsoleSession>) => Record<string, ConsoleSession>) => void;
  notes: boolean;
  setNotes: (b: boolean) => void;
  question?: CliQuestion;
  setQuestion: (q: CliQuestion | undefined) => void;
}
export interface RnWin {
  id: RnDev;
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
const Kv = ({ k, v, tone }: { k: string; v: ReactNode; tone?: "warn" | "bad" | "ok" }) => (
  <div className="flex justify-between gap-3 border-b border-pv-border/50 py-1 text-[12.5px]">
    <span className="text-pv-text-muted">{k}</span>
    <span className={clsx("pv-mono text-right", tone === "bad" ? "text-pv-danger" : tone === "warn" ? "text-pv-warning" : tone === "ok" ? "text-pv-success" : "text-pv-text")}>{v}</span>
  </div>
);
const btn = "rounded-full border border-pv-border px-2.5 py-0.5 text-[12px] font-semibold text-pv-text-muted hover:border-pv-cyan/60 hover:text-pv-text disabled:opacity-40";

// ---------------------------------------------------------------------------------------------------------------
// Captures
// ---------------------------------------------------------------------------------------------------------------
export const capPoints = (): string[] => [...RN_ROUTERS.flatMap((r) => RN_IFS.map((i) => `${r} ${i}`)), ...RN_HOSTS];
export function CaptureView({ s, points, initial, vendor }: { s: RnState; points: string[]; initial?: string; vendor: CliVendor }) {
  const [point, setPoint] = useState<string>(initial ?? points[0]);
  const [onlyLast, setOnlyLast] = useState(true);
  const [pick, setPick] = useState<RnCap | undefined>(undefined);
  const rows = s.captures.filter((c) => c.point === point && (!onlyLast || !s.last || c.run === s.last.id)).slice(-120);
  const label = (p: string) => (p.includes(" ") ? `${p.split(" ")[0]} ${ifName(vendor, p.split(" ")[1])} (${RN_SEG_NAME[RN_IF_SEG[p.split(" ")[0] as RnRouter][p.split(" ")[1] as RnIf]]})` : `${p} eth0`);
  return (
    <div className="space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-pv-text-muted">
        {points.length > 1 && (
          <select value={point} onChange={(e) => (setPoint(e.target.value), setPick(undefined))} className="rounded-md border border-pv-border bg-pv-bg px-2 py-0.5 text-[12px] text-pv-text" aria-label="Capture point">
            {points.map((p) => (
              <option key={p} value={p}>
                {label(p)}
              </option>
            ))}
          </select>
        )}
        <label className="ml-auto flex items-center gap-1">
          <input type="checkbox" checked={onlyLast} onChange={(e) => setOnlyLast(e.target.checked)} /> last test only
        </label>
      </div>
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-pv-text-faint">Nothing crossed {label(point)}{onlyLast ? " in the last test" : ""}. Silence is evidence: no packet used this interface.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-[12px]">
            <thead className="text-[11px] text-pv-text-faint">
              <tr>
                <th className="px-1.5 py-1">#</th>
                <th className="px-1.5 py-1">dir</th>
                <th className="px-1.5 py-1">source → destination</th>
                <th className="px-1.5 py-1">what</th>
                <th className="px-1.5 py-1">TTL</th>
              </tr>
            </thead>
            <tbody className="pv-mono">
              {rows.map((c) => (
                <tr key={c.n} onClick={() => setPick(c)} className={clsx("cursor-pointer border-t border-pv-border/50 hover:bg-white/[0.03]", pick?.n === c.n && "bg-pv-cyan/10", c.pkt && c.pkt.kind !== "echo" && c.pkt.kind !== "reply" && "text-pv-danger", c.arp && "text-pv-violet")}>
                  <td className="px-1.5 py-0.5">{c.n}</td>
                  <td className="px-1.5 py-0.5">{c.dir}</td>
                  <td className="px-1.5 py-0.5">{c.pkt ? `${c.pkt.src} → ${c.pkt.dst}` : c.arp!.op === "request" ? `ARP who-has ${c.arp!.who}` : `ARP ${c.arp!.who} is-at ${c.arp!.mac}`}</td>
                  <td className="px-1.5 py-0.5 font-sans">{c.pkt ? kindName[c.pkt.kind] : c.arp!.op === "request" ? `ARP request (tell ${c.arp!.tell})` : "ARP reply"}</td>
                  <td className="px-1.5 py-0.5">{c.pkt?.ttl ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pick?.pkt && (
        <div className="rounded-xl border border-pv-border bg-pv-bg/60 p-2.5 text-[12.5px]">
          <p className="font-semibold text-pv-text">
            #{pick.n} on {label(pick.point)} ({pick.dir === "in" ? "received" : "sent"})
          </p>
          <div className="mt-1 grid gap-x-4 sm:grid-cols-2">
            <Kv k="IPv4 source" v={`${pick.pkt.src} (${rnName(s.cfg, pick.pkt.src)})`} />
            <Kv k="IPv4 destination" v={`${pick.pkt.dst} (${rnName(s.cfg, pick.pkt.dst)})`} />
            <Kv k="TTL" v={pick.pkt.ttl} />
            <Kv k="ICMP" v={kindName[pick.pkt.kind]} tone={pick.pkt.kind === "echo" || pick.pkt.kind === "reply" ? undefined : "bad"} />
            {pick.pkt.about && <Kv k="About the packet" v={`${pick.pkt.about.src} → ${pick.pkt.about.dst}`} />}
            <Kv k="Next hop address in the packet?" v="no — never written into it" />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------------------------------------------
function cliApi(c: RnDeskCtx, key: string): RnCliApi {
  return { view: c.view, act: c.act, ios: c.ios, setIos: c.setIos, junosEdit: c.junosEdit, setJunosEdit: c.setJunosEdit, cand: c.cand, setCand: c.setCand, ask: c.setQuestion, history: c.consoles[key]?.history ?? [] };
}
export function RouterConsole({ c, r, className }: { c: RnDeskCtx; r: RnRouter; className?: string }) {
  const os = c.vendor === "cisco" ? "ios" : "junos";
  const key = `${r}:${os}`;
  const api = cliApi(c, key);
  return (
    <ConsoleTerminal
      key={key}
      sets={rnRouterSets(api, r)}
      vendor={c.vendor}
      setVendor={c.setVendor}
      os={os}
      host={r}
      session={c.consoles[key] ?? EMPTY_SESSION}
      setSession={(u) => c.setConsoles((m) => ({ ...m, [key]: u(m[key] ?? EMPTY_SESSION) }))}
      notes={c.notes}
      setNotes={c.setNotes}
      question={c.question?.node === r ? c.question : undefined}
      pipeCtx={{ config: rnJunosConfig(api, r), rollbacks: 1 }}
      className={className ?? "h-[min(440px,58vh)]"}
    />
  );
}
function HostConsole({ c, h }: { c: RnDeskCtx; h: RnHost }) {
  const key = `${h}:linux`;
  const api = cliApi(c, key);
  return <ConsoleTerminal key={key} sets={{ cisco: rnHostSet(api, h) }} vendor="cisco" os="linux" host={h} session={c.consoles[key] ?? EMPTY_SESSION} setSession={(u) => c.setConsoles((m) => ({ ...m, [key]: u(m[key] ?? EMPTY_SESSION) }))} notes={c.notes} setNotes={c.setNotes} className="h-[min(440px,58vh)]" />;
}
function RouterUI({ c, r }: { c: RnDeskCtx; r: RnRouter }) {
  const [tab, setTab] = useState<"ifs" | "rib" | "arp" | "term" | "cap">("rib");
  const s = c.view;
  const cfg = s.cfg;
  const ctr = (c.snap ?? s).counters;
  const arp = (c.snap ?? s).arp[r];
  const toggle = (i: RnIf) => {
    const n = rnClone(cfg);
    n.r[r].ifs[i].shut = !n.r[r].ifs[i].shut;
    c.act({ type: "cfg", cfg: n, text: `${r}: interface ${i} ${n.r[r].ifs[i].shut ? "disabled" : "enabled"}` });
  };
  return (
    <>
      <Tabs
        tabs={[
          ["rib", "Routing table"],
          ["ifs", "Interfaces"],
          ["arp", "ARP"],
          ["term", "Console"],
          ["cap", "Capture"],
        ]}
        cur={tab}
        set={setTab}
      />
      {tab === "rib" && (
        <div className="space-y-2 p-3">
          <p className="text-[12.5px] text-pv-text-muted">{r}&apos;s own table — no other router sees it. C = connected (from an interface that is up), S = static (typed by an operator), S* = default. Grayed routes are configured but not installed: they are never used.</p>
          <RouteTable cfg={cfg} r={r} vendor={c.vendor} showLocal />
          <p className="text-[11.5px] text-pv-text-faint">Listed by address. The lookup rule isn&apos;t the order — it&apos;s the longest prefix containing the destination.</p>
        </div>
      )}
      {tab === "ifs" && (
        <div className="space-y-2 p-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[540px] text-left text-[12px]">
              <thead className="text-[11px] text-pv-text-faint">
                <tr>
                  <th className="px-1.5 py-1">interface</th>
                  <th className="px-1.5 py-1">address</th>
                  <th className="px-1.5 py-1">state</th>
                  <th className="px-1.5 py-1">other side</th>
                  <th className="px-1.5 py-1">pkts in / out</th>
                  <th className="px-1.5 py-1" />
                </tr>
              </thead>
              <tbody>
                {RN_IFS.map((i) => {
                  const st = rnIfStatus(cfg, r, i);
                  const peer = rnPeerOf(r, i);
                  const seg = RN_IF_SEG[r][i];
                  const k = ctr[`${r} ${i}`];
                  return (
                    <tr key={i} className="border-t border-pv-border/50">
                      <td className="pv-mono whitespace-nowrap px-1.5 py-1 text-pv-text">{ifName(c.vendor, i)}</td>
                      <td className="pv-mono px-1.5 py-1">
                        {cfg.r[r].ifs[i].addr}/{cfg.r[r].ifs[i].len}
                      </td>
                      <td className={clsx("pv-mono px-1.5 py-1", st === "up" ? "text-pv-success" : "text-pv-danger")}>{st}</td>
                      <td className="px-1.5 py-1 text-pv-text-muted">{peer ? `${peer.r} ${ifName(c.vendor, peer.i)}` : RN_SEG_NAME[seg]}</td>
                      <td className="pv-mono px-1.5 py-1">
                        {k.in} / {k.out}
                      </td>
                      <td className="px-1.5 py-1 text-right">
                        <button type="button" className={btn} onClick={() => toggle(i)}>
                          {cfg.r[r].ifs[i].shut ? "Enable" : "Disable"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-pv-text-muted">An interface that is up gives the router a connected route to its network. Disabling it withdraws that route — and every static route whose next hop was reached through it.</p>
        </div>
      )}
      {tab === "arp" && (
        <div className="space-y-2 p-3">
          {Object.keys(arp).length === 0 ? (
            <p className="text-[12.5px] text-pv-text-faint">Empty: {r} hasn&apos;t needed to reach any neighbor yet.</p>
          ) : (
            Object.entries(arp).map(([ip, mac]) => <Kv key={ip} k={`${ip} (${rnName(cfg, ip)})`} v={mac === "incomplete" ? "incomplete — asked, nobody answered" : mac} tone={mac === "incomplete" ? "bad" : undefined} />)
          )}
          <p className="text-[12px] text-pv-text-muted">The route gives a next-hop IP; ARP turns it into the MAC the new frame is sent to. A route can win and still fail here.</p>
          <button type="button" className={btn} onClick={() => c.act({ type: "clear-arp", dev: r })}>
            Clear ARP cache
          </button>
        </div>
      )}
      {tab === "term" && <RouterConsole c={c} r={r} />}
      {tab === "cap" && <CaptureView s={s} points={RN_IFS.map((i) => `${r} ${i}`)} vendor={c.vendor} />}
    </>
  );
}
function HostUI({ c, h }: { c: RnDeskCtx; h: RnHost }) {
  const [tab, setTab] = useState<"net" | "term" | "cap">("net");
  const s = c.view;
  const x = s.cfg.h[h];
  const others = RN_HOSTS.filter((o) => o !== h);
  return (
    <>
      <Tabs
        tabs={[
          ["net", "Network"],
          ["term", "Terminal"],
          ["cap", "Capture"],
        ]}
        cur={tab}
        set={setTab}
      />
      {tab === "net" && (
        <div className="space-y-2 p-3">
          <Kv k="Address" v={`${x.ip}/${x.len}`} />
          <Kv k="Its network" v={`${netOf(x.ip, x.len)}/${x.len} — reached directly`} />
          <Kv k="Default gateway" v={`${x.gw} (${rnName(s.cfg, x.gw)})`} />
          <p className="text-[12.5px] text-pv-text-muted">A host only decides “my network, or my gateway?”. From the gateway on, routers decide — each with its own table.</p>
          <div className="flex flex-wrap gap-1">
            {others.map((o) => (
              <button key={o} type="button" className={btn} onClick={() => c.act({ type: "ping", from: h, dst: s.cfg.h[o].ip })}>
                Ping {o}
              </button>
            ))}
            <button type="button" className={btn} onClick={() => c.act({ type: "traceroute", from: h, dst: h === "HOST-A" ? "172.16.50.50" : "10.10.10.10" })}>
              Traceroute {h === "HOST-A" ? "SERVER-A" : "HOST-A"}
            </button>
          </div>
        </div>
      )}
      {tab === "term" && <HostConsole c={c} h={h} />}
      {tab === "cap" && <CaptureView s={s} points={[h]} vendor={c.vendor} />}
    </>
  );
}

function Win({ w, c, narrow, focused, onFocus, onMove, onMin, onClose }: { w: RnWin; c: RnDeskCtx; narrow: boolean; focused: boolean; onFocus: () => void; onMove: (x: number, y: number) => void; onMin: () => void; onClose: () => void }) {
  const drag = useRef<{ dx: number; dy: number } | undefined>(undefined);
  const router = isRouter(w.id);
  const tone = router ? "#22d3ee" : "#34d399";
  const sub = router ? `Router · ${c.vendor === "cisco" ? "Cisco IOS" : "Junos"} view · ${rnLookup(c.view.cfg, w.id as RnRouter, "0.0.0.0").candidates.filter((x) => x.route.active && x.route.proto !== "local").length} installed routes` : `${c.view.cfg.h[w.id as RnHost].ip}/${c.view.cfg.h[w.id as RnHost].len} · gw ${c.view.cfg.h[w.id as RnHost].gw}`;
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
      style={narrow ? { zIndex: 100 + w.z } : { left: w.x, top: w.y, width: "min(800px, calc(100vw - 32px))", height: "min(620px, calc(100vh - 96px))", zIndex: 100 + w.z, resize: "both" }}
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
          {router ? "R" : w.id === "HOST-A" ? "💻" : "🗄"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-bold text-pv-text">{w.id}</p>
          <p className="truncate text-[11px] text-pv-text-faint">{sub}</p>
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
      <div className="min-h-0 flex-1 overflow-y-auto">{router ? <RouterUI c={c} r={w.id as RnRouter} /> : <HostUI c={c} h={w.id as RnHost} />}</div>
    </section>
  );
}

export function RnDesk({ windows, setWindows, focus, setFocus, ctx }: { windows: RnWin[]; setWindows: (u: (w: RnWin[]) => RnWin[]) => void; focus?: RnDev; setFocus: (n: RnDev | undefined) => void; ctx: RnDeskCtx }) {
  const narrow = useNarrow();
  if (typeof document === "undefined" || !windows.length) return null;
  const top = Math.max(0, ...windows.map((w) => w.z));
  const raise = (id: RnDev) => {
    setFocus(id);
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, z: top + 1, minimized: false } : w)));
  };
  const minimize = (id: RnDev) => (setWindows((ws) => ws.map((v) => (v.id === id ? { ...v, minimized: true } : v))), setFocus(undefined));
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
export function openRnWindow(ws: RnWin[], id: RnDev): RnWin[] {
  const top = Math.max(0, ...ws.map((w) => w.z));
  if (ws.some((w) => w.id === id)) return ws.map((w) => (w.id === id ? { ...w, minimized: false, z: top + 1 } : w));
  const n = ws.length;
  const x = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerWidth - 820, 40 + n * 36));
  const y = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerHeight - 640, 90 + n * 30));
  return [...ws, { id, minimized: false, x, y, z: top + 1 }];
}
