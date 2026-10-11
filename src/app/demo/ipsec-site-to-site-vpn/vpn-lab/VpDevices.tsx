"use client";

import { clsx } from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CliVendor } from "@/lib/cli/types";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { ConsoleTerminal, EMPTY_SESSION, type ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import { GW, HOST_IP, IKE_PROPS, PSKS, isGw, isHost, otherGw, vpClone, type IkeProp, type VpAction, type VpCap, type VpDev, type VpGw, type VpGwCfg, type VpHost, type VpNet } from "@/lib/sim-engine/scenarios/vpnNet";
import { vpGwSets, vpHostSet, vpInetSets, vpJunosConfig, type VpCand, type VpCliApi, type VpIosMode } from "./vpCli";
import { vpIf } from "./vpMoments";
import { TARGETS, TunnelState } from "./VpPanels";

/**
 * VPN Lab devices (drag, minimize to a tray; full screen on phones).
 *   GW-A, GW-B  VPN (peer, IKE proposal, key, traffic selectors, steering — change any of it; the tunnel state) ·
 *               SAs · Cisco/Junos console · capture on the LAN and WAN side · log
 *   INTERNET    the provider's routes (read-only), looking glass, capture
 *   Hosts       send (pings) · shell · capture
 */
export interface VpDeskCtx {
  view: VpNet;
  act: (a: VpAction) => VpNet;
  vendor: CliVendor;
  setVendor: (v: CliVendor) => void;
  ios: Record<VpGw, VpIosMode>;
  setIos: (g: VpGw, m: VpIosMode) => void;
  junosEdit: Record<VpGw, boolean>;
  setJunosEdit: (g: VpGw, b: boolean) => void;
  cand: VpCand;
  setCand: (c: VpCand) => void;
  consoles: Record<string, ConsoleSession>;
  setConsoles: (u: (m: Record<string, ConsoleSession>) => Record<string, ConsoleSession>) => void;
  notes: boolean;
  setNotes: (b: boolean) => void;
  question?: CliQuestion;
  setQuestion: (q: CliQuestion | undefined) => void;
}
export interface VpWin {
  id: VpDev;
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
export const capPoints = (): string[] => ["HOST-A", "GW-A lan", "GW-A wan", "INTERNET", "GW-B wan", "GW-B lan", "HOST-B", "WEB"];
export const capLabel = (vendor: CliVendor, p: string) => (/ (lan|wan)$/.test(p) ? `${p.split(" ")[0]} ${vpIf(vendor, p.split(" ")[1] as "lan" | "wan")} (${p.split(" ")[1].toUpperCase()})` : p);
const what = (c: VpCap) => (c.pkt.kind === "esp" ? `ESP · SPI ${c.pkt.spi} · seq ${c.pkt.espSeq}` : c.pkt.kind === "ike" ? `IKEv2 ${c.pkt.ike!.ex} ${c.pkt.ike!.resp ? "response" : "request"}${c.pkt.ike!.notify ? ` · ${c.pkt.ike!.notify}` : ""}` : `ICMP ${c.pkt.icmp}`);
export function CaptureView({ s, points, initial, vendor }: { s: VpNet; points: string[]; initial?: string; vendor: CliVendor }) {
  const [point, setPoint] = useState<string>(initial && points.includes(initial) ? initial : points[0]);
  const [onlyLast, setOnlyLast] = useState(true);
  const [pick, setPick] = useState<VpCap | undefined>(undefined);
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
        <p className="text-[12.5px] text-pv-text-faint">Nothing crossed {capLabel(vendor, point)}{onlyLast ? " during the last run" : ""}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] text-left text-[12px]">
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
                <tr key={c.n} onClick={() => setPick(c)} className={clsx("cursor-pointer border-t border-pv-border/50 hover:bg-white/[0.03]", pick?.n === c.n && "bg-pv-cyan/10", c.pkt.kind === "esp" && "text-pv-violet", c.pkt.kind === "ike" && "text-pv-warning")}>
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
      {pick && (
        <div className="rounded-xl border border-pv-border bg-pv-bg/60 p-2.5 text-[12.5px]">
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Kv k={pick.pkt.kind === "icmp" ? "IP source → destination" : "outer IP source → destination"} v={`${pick.pkt.src} → ${pick.pkt.dst}`} />
            <Kv k="IP protocol · TTL" v={`${pick.pkt.kind === "esp" ? "50 (ESP)" : pick.pkt.kind === "ike" ? "17 (UDP 500)" : "1 (ICMP)"} · ${pick.pkt.ttl}`} />
            {pick.pkt.kind === "esp" && (
              <>
                <Kv k="SPI (the receiver's)" v={pick.pkt.spi} />
                <Kv k="sequence number" v={pick.pkt.espSeq} />
                <Kv k="payload" v="encrypted (AES-GCM-256)" />
                <Kv k="inner — decrypted teaching view" v={`${pick.pkt.inner!.src} → ${pick.pkt.inner!.dst} ICMP ${pick.pkt.inner!.icmp}`} />
              </>
            )}
            {pick.pkt.kind === "ike" && (
              <>
                <Kv k="exchange · message ID" v={`${pick.pkt.ike!.ex} · ${pick.pkt.ike!.msgId}`} />
                <Kv k="request / response" v={pick.pkt.ike!.resp ? "response" : "request"} />
                <Kv k="carries" v={pick.pkt.ike!.carries} />
              </>
            )}
          </div>
          {pick.pkt.kind === "esp" && <p className="mt-1 text-[11.5px] text-pv-text-muted">On the wire only the outer header, SPI and sequence number are readable. The inner addresses are shown here for teaching — an eavesdropper sees ciphertext.</p>}
        </div>
      )}
    </div>
  );
}
function cliApi(c: VpDeskCtx, key: string): VpCliApi {
  return { view: c.view, act: c.act, ios: c.ios, setIos: c.setIos, junosEdit: c.junosEdit, setJunosEdit: c.setJunosEdit, cand: c.cand, setCand: c.setCand, ask: c.setQuestion, history: c.consoles[key]?.history ?? [] };
}
export function DevConsole({ c, dev, className }: { c: VpDeskCtx; dev: VpDev; className?: string }) {
  const host = isHost(dev);
  const os = host ? "linux" : c.vendor === "cisco" ? "ios" : "junos";
  const key = `${dev}:${os}`;
  const api = cliApi(c, key);
  const sets = host ? { cisco: vpHostSet(api, dev), juniper: vpHostSet(api, dev) } : isGw(dev) ? vpGwSets(api, dev) : vpInetSets();
  return <ConsoleTerminal key={key} sets={sets} vendor={c.vendor} setVendor={host ? undefined : c.setVendor} os={os} host={dev} session={c.consoles[key] ?? EMPTY_SESSION} setSession={(u) => c.setConsoles((m) => ({ ...m, [key]: u(m[key] ?? EMPTY_SESSION) }))} notes={c.notes} setNotes={c.setNotes} question={c.question?.node === dev ? c.question : undefined} pipeCtx={isGw(dev) ? { config: vpJunosConfig(api, dev), rollbacks: 1 } : undefined} className={className ?? "h-[min(440px,58vh)]"} />;
}
function GatewayUI({ c, g }: { c: VpDeskCtx; g: VpGw }) {
  const [tab, setTab] = useState<"vpn" | "term" | "cap" | "log">("vpn");
  const s = c.view;
  const gc = s.cfg.gw[g];
  const set = (patch: Partial<VpGwCfg>, text: string) => {
    const cfg = vpClone(s.cfg);
    cfg.gw[g] = { ...cfg.gw[g], ...patch };
    c.act({ type: "cfg", cfg, text: `${g}: ${text}` });
  };
  const other = otherGw(g);
  const field = (k: string, el: ReactNode) => (
    <label className="flex flex-wrap items-center justify-between gap-2 border-b border-pv-border/50 py-1 text-[12.5px] text-pv-text-muted">
      {k}
      {el}
    </label>
  );
  return (
    <>
      <Tabs
        tabs={[
          ["vpn", "VPN"],
          ["term", "Console"],
          ["cap", "Capture"],
          ["log", "Log"],
        ]}
        cur={tab}
        set={setTab}
      />
      {tab === "vpn" && (
        <div className="space-y-3 p-3">
          <TunnelState s={s} />
          <div>
            {field(
              "peer (where IKE is sent)",
              <select aria-label={`${g} peer`} className={sel} value={gc.peer} onChange={(e) => set({ peer: e.target.value }, `peer ${e.target.value}`)}>
                {[...new Set([GW[other].wan, g === "GW-A" ? "203.0.113.11" : "198.51.100.11", gc.peer])].map((x) => (
                  <option key={x} value={x}>
                    {x}
                    {x === GW[other].wan ? ` (${other})` : ""}
                  </option>
                ))}
              </select>,
            )}
            {field(
              "IKE proposal",
              <select aria-label={`${g} IKE proposal`} className={sel} value={gc.ike} onChange={(e) => set({ ike: e.target.value as IkeProp }, `IKE proposal ${e.target.value}`)}>
                {(Object.keys(IKE_PROPS) as IkeProp[]).map((p) => (
                  <option key={p} value={p}>
                    {IKE_PROPS[p].encr} · {IKE_PROPS[p].prf} · {IKE_PROPS[p].dh}
                  </option>
                ))}
              </select>,
            )}
            {field(
              "pre-shared key",
              <select aria-label={`${g} pre-shared key`} className={sel} value={gc.psk} onChange={(e) => set({ psk: e.target.value }, "pre-shared key changed")}>
                {[...new Set([...PSKS, gc.psk])].map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>,
            )}
            {field(
              "local selector (protected here)",
              <select aria-label={`${g} local selector`} className={sel} value={gc.local} onChange={(e) => set({ local: e.target.value }, `local selector ${e.target.value}`)}>
                {[...new Set([GW[g].lanNet, g === "GW-A" ? "10.10.0.0/16" : "10.20.0.0/16", gc.local])].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>,
            )}
            {field(
              "remote selector (the other site)",
              <select aria-label={`${g} remote selector`} className={sel} value={gc.remote} onChange={(e) => set({ remote: e.target.value }, `remote selector ${e.target.value}`)}>
                {[...new Set([GW[other].lanNet, g === "GW-A" ? "10.20.0.0/16" : "10.10.0.0/16", g === "GW-A" ? "10.20.30.0/24" : "10.10.20.0/24", gc.remote])].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>,
            )}
            {field(`send ${GW[other].lanNet} into IPsec (${c.vendor === "cisco" ? "crypto map on Gi0/1" : "route via st0.0"})`, <input type="checkbox" aria-label={`${g} steer`} checked={gc.steer} onChange={(e) => set({ steer: e.target.checked }, e.target.checked ? "site traffic into IPsec" : "site traffic NOT into IPsec")} />)}
          </div>
          <p className="text-[11.5px] text-pv-text-muted">Both gateways are yours: each end must mirror the other (peer ↔ peer, same proposal and key, local ↔ remote selectors).</p>
        </div>
      )}
      {tab === "term" && <DevConsole c={c} dev={g} />}
      {tab === "cap" && <CaptureView s={s} points={[`${g} lan`, `${g} wan`]} initial={`${g} wan`} vendor={c.vendor} />}
      {tab === "log" && (
        <div className="space-y-1 p-3 text-[12px]">
          {s.syslog.filter((x) => x.gw === g).length === 0 ? (
            <p className="text-pv-text-faint">No events since the lab started (tunnel {s.tunnel.child === "INSTALLED" ? "up" : "down"}).</p>
          ) : (
            s.syslog
              .filter((x) => x.gw === g)
              .slice(-40)
              .map((x, k) => (
                <p key={k} className={clsx("pv-mono", x.tone === "up" ? "text-pv-success" : "text-pv-danger")}>
                  t={x.clock - 43200}s · {x.text}
                </p>
              ))
          )}
        </div>
      )}
    </>
  );
}
function InetUI({ c }: { c: VpDeskCtx }) {
  const [tab, setTab] = useState<"route" | "term" | "cap">("route");
  return (
    <>
      <Tabs
        tabs={[
          ["route", "Routes"],
          ["term", "Looking glass"],
          ["cap", "Capture"],
        ]}
        cur={tab}
        set={setTab}
      />
      {tab === "route" && (
        <div className="space-y-1 p-3 text-[12px]">
          <Kv k={`${GW["GW-A"].wanNet}`} v="→ GW-A" />
          <Kv k={`${GW["GW-B"].wanNet}`} v={c.view.cfg.wanB ? "→ GW-B" : "link down"} tone={c.view.cfg.wanB ? undefined : "bad"} />
          <Kv k="192.0.2.0/24" v="→ WEB" />
          <p className="text-[11.5px] text-pv-text-muted">No route to 10.10.10.0/24 or 10.20.20.0/24: the sites exist only inside ESP. Not your router — read-only.</p>
        </div>
      )}
      {tab === "term" && <DevConsole c={c} dev="INTERNET" />}
      {tab === "cap" && <CaptureView s={c.view} points={["INTERNET"]} vendor={c.vendor} />}
    </>
  );
}
function HostUI({ c, h }: { c: VpDeskCtx; h: VpHost }) {
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
          <Kv k="IPv4 · gateway" v={`${HOST_IP[h]} · ${h === "WEB" ? "192.0.2.1" : GW[h === "HOST-A" ? "GW-A" : "GW-B"].lan}`} />
          <div className="flex flex-wrap gap-1">
            {TARGETS.filter((t) => t.ip !== HOST_IP[h]).map((t) => (
              <button key={t.ip} type="button" className={btn} onClick={() => c.act({ type: "traffic", sends: [{ from: h, to: t.ip }] })}>
                Ping {t.label}
              </button>
            ))}
          </div>
          {s.last && s.last.results[0]?.send.from === h && <p className={clsx("text-[12px]", s.last.results[0].replied ? "text-pv-success" : "text-pv-danger")}>{s.last.results[0].replied ? `reply ${s.last.results[0].encrypted ? "— through the tunnel" : "— in the clear"}` : s.last.results[0].fail}</p>}
        </div>
      )}
      {tab === "shell" && <DevConsole c={c} dev={h} />}
      {tab === "cap" && <CaptureView s={s} points={[h]} vendor={c.vendor} />}
    </>
  );
}

function Win({ w, c, narrow, focused, onFocus, onMove, onMin, onClose }: { w: VpWin; c: VpDeskCtx; narrow: boolean; focused: boolean; onFocus: () => void; onMove: (x: number, y: number) => void; onMin: () => void; onClose: () => void }) {
  const drag = useRef<{ dx: number; dy: number } | undefined>(undefined);
  const tone = isGw(w.id) ? "#f59e0b" : w.id === "INTERNET" ? "#a78bfa" : "#34d399";
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
          {isGw(w.id) ? "GW" : w.id === "INTERNET" ? "☁" : "💻"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-bold text-pv-text">
            {w.id}
          </p>
          <p className="truncate text-[11px] text-pv-text-faint">{isGw(w.id) ? `${w.id === "GW-A" ? "Site A" : "Site B"} gateway · ${GW[w.id].wan} · ${c.vendor === "cisco" ? "Cisco IOS" : "Junos"} view` : w.id === "INTERNET" ? "read-only looking glass" : `${HOST_IP[w.id as VpHost]} · Linux`}</p>
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
      <div className="min-h-0 flex-1 overflow-y-auto">{isGw(w.id) ? <GatewayUI c={c} g={w.id} /> : w.id === "INTERNET" ? <InetUI c={c} /> : <HostUI c={c} h={w.id as VpHost} />}</div>
    </section>
  );
}
export function VpDesk({ windows, setWindows, focus, setFocus, ctx }: { windows: VpWin[]; setWindows: (u: (w: VpWin[]) => VpWin[]) => void; focus?: VpDev; setFocus: (n: VpDev | undefined) => void; ctx: VpDeskCtx }) {
  const narrow = useNarrow();
  if (typeof document === "undefined" || !windows.length) return null;
  const top = Math.max(0, ...windows.map((w) => w.z));
  const raise = (id: VpDev) => {
    setFocus(id);
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, z: top + 1, minimized: false } : w)));
  };
  const minimize = (id: VpDev) => (setWindows((ws) => ws.map((v) => (v.id === id ? { ...v, minimized: true } : v))), setFocus(undefined));
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
export function openVpWindow(ws: VpWin[], id: VpDev): VpWin[] {
  const top = Math.max(0, ...ws.map((w) => w.z));
  if (ws.some((w) => w.id === id)) return ws.map((w) => (w.id === id ? { ...w, minimized: false, z: top + 1 } : w));
  const n = ws.length;
  const x = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerWidth - 920, 40 + n * 36));
  const y = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerHeight - 660, 90 + n * 30));
  return [...ws, { id, minimized: false, x, y, z: top + 1 }];
}
