"use client";

import { clsx } from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CliVendor } from "@/lib/cli/types";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { ConsoleTerminal, EMPTY_SESSION, type ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import { ASN, BG_HOSTS, BG_ROUTERS, HOST_IP, LAN, RID, ROLE, ROUTER_OF, SESSIONS, advKey, bgClone, isOurs, isRouter, sessAddr, sessionsOf, type BgAction, type BgCap, type BgDev, type BgHost, type BgNbrCfg, type BgNet, type BgRouter, type BgSession } from "@/lib/sim-engine/scenarios/bgpNet";
import { bgHostSet, bgJunosConfig, bgRouterSets, type BgCand, type BgCliApi, type BgIosMode } from "./bgCli";
import { ifOfAddr } from "./bgNames";
import { BestPaths } from "./BgPanels";

/**
 * BGP Lab devices (drag, minimize to a tray; full screen on phones).
 *   R1, R2  BGP (every neighbor: remote AS, state, and the policies attached — change any of it) · Paths (every
 *           candidate per prefix, best and why) · Routes · Announced (what goes to each neighbor) · Cisco/Junos
 *           console · capture · log
 *   R3–R5   the ISPs' looking glass: their BGP table, routes, a read-only console, capture
 *   Hosts   send (ping, traceroute) · shell · capture
 */
export interface BgDeskCtx {
  view: BgNet;
  act: (a: BgAction) => BgNet;
  vendor: CliVendor;
  setVendor: (v: CliVendor) => void;
  ios: Record<"R1" | "R2", BgIosMode>;
  setIos: (d: "R1" | "R2", m: BgIosMode) => void;
  junosEdit: Record<"R1" | "R2", boolean>;
  setJunosEdit: (d: "R1" | "R2", b: boolean) => void;
  cand: BgCand;
  setCand: (c: BgCand) => void;
  consoles: Record<string, ConsoleSession>;
  setConsoles: (u: (m: Record<string, ConsoleSession>) => Record<string, ConsoleSession>) => void;
  notes: boolean;
  setNotes: (b: boolean) => void;
  question?: CliQuestion;
  setQuestion: (q: CliQuestion | undefined) => void;
}
export interface BgWin {
  id: BgDev;
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
const ST_TONE: Record<string, string> = { Established: "text-pv-success", Active: "text-pv-danger", Idle: "text-pv-text-faint", "Idle (Admin)": "text-pv-warning" };

export const capPoints = (): string[] => [...BG_ROUTERS, ...BG_HOSTS];
const pktText = (c: BgCap) => (c.pkt.kind === "update" ? `BGP UPDATE ${c.pkt.upd!.prefixes.join(", ")} · AS_PATH ${c.pkt.upd!.asPath.join(" ") || "(empty)"}` : c.pkt.kind === "echo" ? `ICMP echo · TTL ${c.pkt.ttl}` : `ICMP reply · TTL ${c.pkt.ttl}`);
export function CaptureView({ s, points, initial }: { s: BgNet; points: string[]; initial?: string }) {
  const [point, setPoint] = useState<string>(initial && points.includes(initial) ? initial : points[0]);
  const [onlyLast, setOnlyLast] = useState(true);
  const [pick, setPick] = useState<BgCap | undefined>(undefined);
  const rows = s.captures.filter((c) => c.point === point && (!onlyLast || !s.last || c.run === s.last.id)).slice(-120);
  const peer = (c: BgCap) => (c.dir === "out" ? c.pkt.dst : c.pkt.src);
  return (
    <div className="space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-pv-text-muted">
        {points.length > 1 && (
          <select value={point} onChange={(e) => (setPoint(e.target.value), setPick(undefined))} className="rounded-md border border-pv-border bg-pv-bg px-2 py-0.5 text-[12px] text-pv-text" aria-label="Capture point">
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
        <p className="text-[12.5px] text-pv-text-faint">Nothing crossed {point}{onlyLast ? " during the last run" : ""}. (UPDATEs appear when you show the UPDATEs; ICMP when you ping or traceroute.)</p>
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
                <tr key={c.n} onClick={() => setPick(c)} className={clsx("cursor-pointer border-t border-pv-border/50 hover:bg-white/[0.03]", pick?.n === c.n && "bg-pv-cyan/10", c.pkt.kind === "update" && "text-pv-violet")}>
                  <td className="px-1.5 py-0.5">{c.n}</td>
                  <td className="px-1.5 py-0.5">{c.dir}</td>
                  <td className="px-1.5 py-0.5">{c.pkt.kind === "update" ? `${c.pkt.src} → ${c.pkt.dst}` : `${c.pkt.src} → ${c.pkt.dst}`}</td>
                  <td className="px-1.5 py-0.5 font-sans">{pktText(c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pick && (
        <div className="rounded-xl border border-pv-border bg-pv-bg/60 p-2.5 text-[12.5px]">
          <div className="grid gap-x-4 sm:grid-cols-2">
            {pick.pkt.kind === "update" ? (
              <>
                <Kv k="Transport" v="TCP port 179 (BGP session)" />
                <Kv k="Speaker → peer" v={`${pick.pkt.src} (AS${ASN[pick.pkt.src as BgRouter]}) → ${pick.pkt.dst} (AS${ASN[pick.pkt.dst as BgRouter]})`} />
                <Kv k="NLRI (prefix)" v={pick.pkt.upd!.prefixes.join(", ")} />
                <Kv k="AS_PATH" v={pick.pkt.upd!.asPath.join(" ") || "(empty: originated in this AS)"} />
                <Kv k="NEXT_HOP" v={pick.pkt.upd!.nextHop} />
                <Kv k="LOCAL_PREF" v={pick.pkt.upd!.localPref ?? "not sent (eBGP)"} />
                <Kv k="ORIGIN" v="IGP" />
                <Kv k="direction" v={`${pick.dir} · ${peer(pick)}`} />
              </>
            ) : (
              <>
                <Kv k="IP source → destination" v={`${pick.pkt.src} → ${pick.pkt.dst}`} />
                <Kv k="TTL" v={pick.pkt.ttl} />
                <Kv k="IP protocol" v="1 (ICMP)" />
                <Kv k="type" v={pick.pkt.kind === "echo" ? "8 echo request" : "0 echo reply"} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function cliApi(c: BgDeskCtx, key: string): BgCliApi {
  return { view: c.view, act: c.act, ios: c.ios, setIos: c.setIos, junosEdit: c.junosEdit, setJunosEdit: c.setJunosEdit, cand: c.cand, setCand: c.setCand, ask: c.setQuestion, history: c.consoles[key]?.history ?? [] };
}
export function DevConsole({ c, dev, className }: { c: BgDeskCtx; dev: BgDev; className?: string }) {
  const host = !isRouter(dev);
  const os = host ? "linux" : c.vendor === "cisco" ? "ios" : "junos";
  const key = `${dev}:${os}`;
  const api = cliApi(c, key);
  const sets = host ? { cisco: bgHostSet(api, dev as BgHost), juniper: bgHostSet(api, dev as BgHost) } : bgRouterSets(api, dev as BgRouter);
  return <ConsoleTerminal key={key} sets={sets} vendor={c.vendor} setVendor={host ? undefined : c.setVendor} os={os} host={dev} session={c.consoles[key] ?? EMPTY_SESSION} setSession={(u) => c.setConsoles((m) => ({ ...m, [key]: u(m[key] ?? EMPTY_SESSION) }))} notes={c.notes} setNotes={c.setNotes} question={c.question?.node === dev ? c.question : undefined} pipeCtx={isOurs(dev) ? { config: bgJunosConfig(api, dev), rollbacks: 1 } : undefined} className={className ?? "h-[min(440px,58vh)]"} />;
}

function RoutesTable({ s, r, vendor }: { s: BgNet; r: BgRouter; vendor: CliVendor }) {
  return (
    <table className="w-full text-left text-[12px]">
      <thead className="text-[11px] text-pv-text-faint">
        <tr>
          <th className="px-1.5 py-1">prefix</th>
          <th className="px-1.5 py-1">source</th>
          <th className="px-1.5 py-1">next hop</th>
        </tr>
      </thead>
      <tbody className="pv-mono">
        {s.view.rib[r]
          .filter((x) => x.proto !== "L")
          .sort((a, b) => a.prefix.localeCompare(b.prefix))
          .map((x) => (
            <tr key={x.prefix} className={clsx("border-t border-pv-border/50", x.proto === "B" && "text-pv-cyan-soft")}>
              <td className="px-1.5 py-0.5">{x.prefix}</td>
              <td className="px-1.5 py-0.5">{x.proto === "B" ? `${x.path?.type} [${vendor === "cisco" ? x.ad : 170}]` : "connected"}</td>
              <td className="px-1.5 py-0.5">{x.proto === "B" ? `${x.nh} (${ifOfAddr(r, x.via, vendor)})` : ifOfAddr(r, x.via, vendor)}</td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}
function NbrRow({ c, r, x }: { c: BgDeskCtx; r: "R1" | "R2"; x: BgSession }) {
  const s = c.view;
  const n = s.cfg.r[r].nbrs[x]!;
  const st = s.view.sess[x];
  const { peer, peerRouter } = sessAddr(x, r);
  const ebgp = SESSIONS[x].type === "eBGP";
  const set = (patch: Partial<BgNbrCfg>, text: string) => {
    const cfg = bgClone(s.cfg);
    cfg.r[r].nbrs[x] = { ...cfg.r[r].nbrs[x]!, ...patch };
    c.act({ type: "cfg", cfg, text: `${r} neighbor ${peer}: ${text}` });
  };
  const chk = (on: boolean, label: string, f: (b: boolean) => void, hint: string) => (
    <label className="flex items-center gap-1 whitespace-nowrap text-[12px] text-pv-text-muted" title={hint}>
      <input type="checkbox" checked={on} aria-label={`${r} ${peer} ${label}`} onChange={(e) => f(e.target.checked)} /> {label}
    </label>
  );
  const asChoices = [...new Set([ASN[peerRouter], n.remoteAs, ebgp ? (peerRouter === "R3" ? 65100 : 65200) : 65001])];
  return (
    <div className="space-y-1 rounded-xl border border-pv-border p-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="pv-mono font-semibold text-pv-text">{peer}</span>
        <span className="text-[12px] text-pv-text-muted">
          {peerRouter} · {ROLE[peerRouter]} · {SESSIONS[x].type}
        </span>
        <span className={clsx("pv-mono text-[12px] font-bold", s.cfg.links[SESSIONS[x].link] ? ST_TONE[st.state] : "text-pv-text-faint")}>{s.cfg.links[SESSIONS[x].link] ? st.state : "link down"}</span>
      </div>
      {st.why && st.state !== "Established" && <p className="text-[11.5px] text-pv-text-muted">{st.why}</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label className="flex items-center gap-1 text-[12px] text-pv-text-muted">
          remote AS
          <select aria-label={`${r} ${peer} remote AS`} className={sel} value={n.remoteAs} onChange={(e) => set({ remoteAs: +e.target.value }, `remote-as ${e.target.value}`)}>
            {asChoices.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        {ebgp ? (
          <>
            {chk(n.lpIn === 200, "LOCAL_PREF 200 in", (b) => set({ lpIn: b ? 200 : undefined }, b ? "route-map LP200 in" : "no route-map LP200 in"), "Inbound: routes from this ISP get LOCAL_PREF 200 (preferred exit for the whole AS)")}
            {chk(n.prepend > 0, "prepend ×2 out", (b) => set({ prepend: b ? 2 : 0 }, b ? "route-map PREPEND out" : "no route-map PREPEND out"), "Outbound: our AS three times — the internet prefers the other ISP to reach us")}
            {chk(n.ownOnly, "only our prefixes out", (b) => set({ ownOnly: b }, b ? "prefix-list OWN out" : "no prefix-list OWN out"), "Outbound filter: announce only 192.0.2.128/26 and 192.0.2.192/26 — never transit")}
          </>
        ) : (
          chk(n.nhs, "next-hop-self", (b) => set({ nhs: b }, b ? "next-hop-self" : "no next-hop-self"), "iBGP: announce ISP routes with this router as next hop")
        )}
        <button type="button" className={btn} onClick={() => set({ shut: !n.shut }, n.shut ? "no shutdown" : "shutdown")}>
          {n.shut ? "No shutdown" : "Shut down"}
        </button>
      </div>
    </div>
  );
}
function RouterUI({ c, r }: { c: BgDeskCtx; r: BgRouter }) {
  const ours = isOurs(r);
  const [tab, setTab] = useState<"bgp" | "paths" | "routes" | "adv" | "term" | "cap" | "log">(ours ? "bgp" : "paths");
  const s = c.view;
  const logs = s.syslog.filter((x) => x.r === r);
  const tabs: [typeof tab, string][] = ours
    ? [
        ["bgp", "BGP"],
        ["paths", "Paths"],
        ["routes", "Routes"],
        ["adv", "Announced"],
        ["term", "Console"],
        ["cap", "Capture"],
        ["log", "Log"],
      ]
    : [
        ["paths", "BGP table"],
        ["routes", "Routes"],
        ["term", "Looking glass"],
        ["cap", "Capture"],
      ];
  return (
    <>
      <Tabs tabs={tabs} cur={tab} set={setTab} />
      {tab === "bgp" && ours && (
        <div className="space-y-2 p-3">
          <p className="text-[12.5px] text-pv-text-muted">
            router bgp 65001 · router ID {RID[r]} · announces {LAN[r].prefix}. A session comes up only when each side&apos;s remote AS matches the other&apos;s real AS. Policies decide what is accepted (inbound) and what is announced (outbound).
          </p>
          {sessionsOf(r).map((x) => (
            <NbrRow key={x} c={c} r={r} x={x} />
          ))}
        </div>
      )}
      {tab === "paths" && (
        <div className="p-3">
          <BestPaths key={r} s={s} initial={r} prefix={r === "R5" ? LAN.R1.prefix : r === "R3" || r === "R4" ? LAN.R1.prefix : LAN.R5.prefix} />
          {!ours && <p className="mt-1 text-[11.5px] text-pv-text-muted">{ROLE[r]} — not your router: you can only read it. Change what R1 / R2 announce, and watch what this router chooses.</p>}
        </div>
      )}
      {tab === "routes" && (
        <div className="space-y-1 p-3">
          <RoutesTable s={s} r={r} vendor={c.vendor} />
          <p className="text-[11.5px] text-pv-text-muted">Only the BEST valid BGP path is installed. Cisco: eBGP distance 20, iBGP 200 · Junos: BGP preference 170.</p>
        </div>
      )}
      {tab === "adv" && ours && (
        <div className="space-y-2 p-3 text-[12px]">
          {sessionsOf(r).map((x) => {
            const to = sessAddr(x, r).peerRouter;
            const list = s.view.adv[advKey(r, to)] ?? [];
            return (
              <div key={x} className="rounded-lg border border-pv-border p-2">
                <p className="font-semibold text-pv-text">
                  {r} → {to} ({ROLE[to]})
                </p>
                {list.length ? (
                  list.map((p) => (
                    <p key={p.prefix} className={clsx("pv-mono", SESSIONS[x].type === "eBGP" && !p.prefix.startsWith("192.0.2.") ? "text-pv-danger" : "text-pv-text-muted")}>
                      {p.prefix} · AS_PATH {p.asPath.join(" ") || "(empty)"} · next hop {p.nextHop}
                      {SESSIONS[x].type === "iBGP" ? ` · LOCAL_PREF ${p.localPref}` : ""}
                    </p>
                  ))
                ) : (
                  <p className="text-pv-text-faint">nothing</p>
                )}
              </div>
            );
          })}
          <p className="text-[11.5px] text-pv-text-muted">To an ISP: only our own prefixes (anything else is a leak — we&apos;d become a transit AS). To the other enterprise router: everything we chose as best, except what we learned over iBGP (iBGP split horizon).</p>
        </div>
      )}
      {tab === "term" && <DevConsole c={c} dev={r} />}
      {tab === "cap" && <CaptureView s={s} points={[r]} />}
      {tab === "log" && (
        <div className="space-y-1 p-3 text-[12.5px]">
          {logs.length === 0 ? (
            <p className="text-pv-text-faint">No events.</p>
          ) : (
            logs.slice(-40).map((x, k) => (
              <p key={k} className={clsx("pv-mono text-[12px]", x.ev === "up" ? "text-pv-success" : "text-pv-danger")}>
                t={x.clock - 14400}s · neighbor {x.peer} {x.ev === "up" ? "Up" : x.ev === "down" ? `Down${x.text ? ` (${x.text})` : ""}` : `NOTIFICATION: ${x.text}`}
              </p>
            ))
          )}
        </div>
      )}
    </>
  );
}
function HostUI({ c, h }: { c: BgDeskCtx; h: BgHost }) {
  const [tab, setTab] = useState<"send" | "shell" | "cap">("send");
  const others = BG_HOSTS.filter((x) => x !== h);
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
          <Kv k="IPv4 · gateway" v={`${HOST_IP[h]}/${LAN[ROUTER_OF[h]].prefix.split("/")[1]} · ${LAN[ROUTER_OF[h]].gw} (${ROUTER_OF[h]})`} />
          <div className="flex flex-wrap gap-1">
            {others.map((o) => (
              <button key={o} type="button" className={btn} onClick={() => c.act({ type: "traffic", sends: [{ from: h, to: HOST_IP[o], kind: "ping" }] })}>
                Ping {o}
              </button>
            ))}
            {others.map((o) => (
              <button key={`t${o}`} type="button" className={btn} onClick={() => c.act({ type: "traffic", sends: [{ from: h, to: HOST_IP[o], kind: "trace" }] })}>
                Traceroute {o}
              </button>
            ))}
          </div>
        </div>
      )}
      {tab === "shell" && <DevConsole c={c} dev={h} />}
      {tab === "cap" && <CaptureView s={c.view} points={[h]} />}
    </>
  );
}
function Win({ w, c, narrow, focused, onFocus, onMove, onMin, onClose }: { w: BgWin; c: BgDeskCtx; narrow: boolean; focused: boolean; onFocus: () => void; onMove: (x: number, y: number) => void; onMin: () => void; onClose: () => void }) {
  const drag = useRef<{ dx: number; dy: number } | undefined>(undefined);
  const tone = isRouter(w.id) ? (isOurs(w.id) ? "#f59e0b" : "#a78bfa") : "#34d399";
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
          {isRouter(w.id) ? "R" : "💻"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-bold text-pv-text">
            {w.id}
            {isRouter(w.id) && !isOurs(w.id) ? ` · ${ROLE[w.id]}` : ""}
          </p>
          <p className="truncate text-[11px] text-pv-text-faint">{isRouter(w.id) ? (isOurs(w.id) ? `AS65001 · router ID ${RID[w.id]} · ${c.vendor === "cisco" ? "Cisco IOS" : "Junos"} view` : `AS${ASN[w.id]} · read-only looking glass`) : `${HOST_IP[w.id as BgHost]} · Linux`}</p>
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
      <div className="min-h-0 flex-1 overflow-y-auto">{isRouter(w.id) ? <RouterUI c={c} r={w.id} /> : <HostUI c={c} h={w.id as BgHost} />}</div>
    </section>
  );
}
export function BgDesk({ windows, setWindows, focus, setFocus, ctx }: { windows: BgWin[]; setWindows: (u: (w: BgWin[]) => BgWin[]) => void; focus?: BgDev; setFocus: (n: BgDev | undefined) => void; ctx: BgDeskCtx }) {
  const narrow = useNarrow();
  if (typeof document === "undefined" || !windows.length) return null;
  const top = Math.max(0, ...windows.map((w) => w.z));
  const raise = (id: BgDev) => {
    setFocus(id);
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, z: top + 1, minimized: false } : w)));
  };
  const minimize = (id: BgDev) => (setWindows((ws) => ws.map((v) => (v.id === id ? { ...v, minimized: true } : v))), setFocus(undefined));
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
export function openBgWindow(ws: BgWin[], id: BgDev): BgWin[] {
  const top = Math.max(0, ...ws.map((w) => w.z));
  if (ws.some((w) => w.id === id)) return ws.map((w) => (w.id === id ? { ...w, minimized: false, z: top + 1 } : w));
  const n = ws.length;
  const x = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerWidth - 920, 40 + n * 36));
  const y = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerHeight - 660, 90 + n * 30));
  return [...ws, { id, minimized: false, x, y, z: top + 1 }];
}
