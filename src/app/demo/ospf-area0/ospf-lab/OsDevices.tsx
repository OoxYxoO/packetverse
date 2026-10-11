"use client";

import { clsx } from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CliVendor } from "@/lib/cli/types";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { ConsoleTerminal, EMPTY_SESSION, type ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import { HOST_IP, IF_ADDR, OS_HOSTS, OS_IFS, RID, ROUTER_OF, isRouter, linkOf, osClone, osFib, peerOf, routeText, type OsAction, type OsCap, type OsDev, type OsHost, type OsIf, type OsIfCfg, type OsRouter, type OsState } from "@/lib/sim-engine/scenarios/ospfNet";
import { osHostSet, osJunosConfig, osRouterSets, type OsCand, type OsCliApi, type OsIosMode } from "./osCli";
import { osIfName } from "./osNames";

/**
 * OSPF Lab devices (drag, minimize to a tray; full screen on phones).
 *   R1–R4  OSPF (every interface: in OSPF?, area, cost, passive, timers, MTU — change any of it; the neighbors and
 *          their state) · Routes (what the router uses, what it keeps but doesn't use, static routes) · LSDB ·
 *          Cisco/Junos console · capture · log
 *   Hosts  send (ping, traceroute) · shell · capture
 */
export interface OsDeskCtx {
  view: OsState;
  act: (a: OsAction) => OsState;
  vendor: CliVendor;
  setVendor: (v: CliVendor) => void;
  ios: Record<OsRouter, OsIosMode>;
  setIos: (d: OsRouter, m: OsIosMode) => void;
  junosEdit: Record<OsRouter, boolean>;
  setJunosEdit: (d: OsRouter, b: boolean) => void;
  cand: OsCand;
  setCand: (c: OsCand) => void;
  consoles: Record<string, ConsoleSession>;
  setConsoles: (u: (m: Record<string, ConsoleSession>) => Record<string, ConsoleSession>) => void;
  notes: boolean;
  setNotes: (b: boolean) => void;
  question?: CliQuestion;
  setQuestion: (q: CliQuestion | undefined) => void;
}
export interface OsWin {
  id: OsDev;
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
const ST_TONE: Record<string, string> = { FULL: "text-pv-success", EXSTART: "text-pv-warning", DOWN: "text-pv-danger", INIT: "text-pv-warning" };

export const capPoints = (): string[] => [...(["R1", "R2", "R3", "R4"] as OsRouter[]).flatMap((r) => OS_IFS.filter((i) => i !== "lo0").map((i) => `${r} ${i}`)), ...OS_HOSTS];
export const capLabel = (vendor: CliVendor, p: string) => (p.includes(" ") ? `${p.split(" ")[0]} ${osIfName(vendor, p.split(" ")[1])}` : p);
export function CaptureView({ s, points, initial, vendor }: { s: OsState; points: string[]; initial?: string; vendor: CliVendor }) {
  const [point, setPoint] = useState<string>(initial && points.includes(initial) ? initial : points[0]);
  const [onlyLast, setOnlyLast] = useState(true);
  const [pick, setPick] = useState<OsCap | undefined>(undefined);
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
        <p className="text-[12.5px] text-pv-text-faint">Nothing crossed {capLabel(vendor, point)}{onlyLast ? " during the last run" : ""}. (Hellos appear when you send Hellos; LSUs when you show a flood.)</p>
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
                <tr key={c.n} onClick={() => setPick(c)} className={clsx("cursor-pointer border-t border-pv-border/50 hover:bg-white/[0.03]", pick?.n === c.n && "bg-pv-cyan/10", c.pkt.kind === "hello" && "text-pv-violet", c.pkt.kind === "lsu" && "text-pv-warning")}>
                  <td className="px-1.5 py-0.5">{c.n}</td>
                  <td className="px-1.5 py-0.5">{c.dir}</td>
                  <td className="px-1.5 py-0.5">
                    {c.pkt.src} → {c.pkt.dst}
                  </td>
                  <td className="px-1.5 py-0.5 font-sans">{c.pkt.kind === "hello" ? `OSPF Hello (RID ${c.pkt.info?.rid})` : c.pkt.kind === "lsu" ? `OSPF LS Update (${c.pkt.info?.origin}'s LSA)` : c.pkt.kind === "echo" ? `ICMP echo · TTL ${c.pkt.ttl}` : `ICMP reply · TTL ${c.pkt.ttl}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pick && (
        <div className="rounded-xl border border-pv-border bg-pv-bg/60 p-2.5 text-[12.5px]">
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Kv k="IP source → destination" v={`${pick.pkt.src} → ${pick.pkt.dst}`} />
            <Kv k="TTL" v={pick.pkt.ttl} />
            {pick.pkt.kind === "hello" ? (
              <>
                <Kv k="IP protocol" v="89 (OSPF), type 1 Hello" />
                <Kv k="Router ID · area" v={`${pick.pkt.info?.rid} · ${pick.pkt.info?.area}`} />
                <Kv k="Hello / dead" v={`${pick.pkt.info?.hello} / ${pick.pkt.info?.dead} s`} />
                <Kv k="Neighbors seen" v={pick.pkt.info?.seen?.join(", ") || "none yet"} />
              </>
            ) : pick.pkt.kind === "lsu" ? (
              <>
                <Kv k="IP protocol" v="89 (OSPF), type 4 LS Update" />
                <Kv k="LSA" v={`Router-LSA of ${pick.pkt.info?.origin}, seq 0x${(0x80000000 + (pick.pkt.info?.seq ?? 1)).toString(16)}`} />
              </>
            ) : (
              <Kv k="IP protocol" v="1 (ICMP)" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function cliApi(c: OsDeskCtx, key: string): OsCliApi {
  return { view: c.view, act: c.act, ios: c.ios, setIos: c.setIos, junosEdit: c.junosEdit, setJunosEdit: c.setJunosEdit, cand: c.cand, setCand: c.setCand, ask: c.setQuestion, history: c.consoles[key]?.history ?? [] };
}
export function DevConsole({ c, dev, className }: { c: OsDeskCtx; dev: OsDev; className?: string }) {
  const host = !isRouter(dev);
  const os = host ? "linux" : c.vendor === "cisco" ? "ios" : "junos";
  const key = `${dev}:${os}`;
  const api = cliApi(c, key);
  const sets = host ? { cisco: osHostSet(api, dev as OsHost), juniper: osHostSet(api, dev as OsHost) } : osRouterSets(api, dev as OsRouter);
  return <ConsoleTerminal key={key} sets={sets} vendor={c.vendor} setVendor={host ? undefined : c.setVendor} os={os} host={dev} session={c.consoles[key] ?? EMPTY_SESSION} setSession={(u) => c.setConsoles((m) => ({ ...m, [key]: u(m[key] ?? EMPTY_SESSION) }))} notes={c.notes} setNotes={c.setNotes} question={c.question?.node === dev ? c.question : undefined} pipeCtx={host ? undefined : { config: osJunosConfig(api, dev as OsRouter), rollbacks: 1 }} className={className ?? "h-[min(440px,58vh)]"} />;
}

function RouterUI({ c, r }: { c: OsDeskCtx; r: OsRouter }) {
  const [tab, setTab] = useState<"ospf" | "routes" | "lsdb" | "term" | "cap" | "log">("ospf");
  const s = c.view;
  const rc = s.cfg.r[r];
  const setIf = (i: OsIf, patch: Partial<OsIfCfg>, text: string) => {
    const n = osClone(s.cfg);
    n.r[r].ifs[i] = { ...n.r[r].ifs[i], ...patch };
    c.act({ type: "cfg", cfg: n, text: `${r} ${i}: ${text}` });
  };
  const fib = osFib(s.view, r);
  const logs = s.syslog.filter((x) => x.r === r);
  return (
    <>
      <Tabs
        tabs={[
          ["ospf", "OSPF"],
          ["routes", "Routes"],
          ["lsdb", "LSDB"],
          ["term", "Console"],
          ["cap", "Capture"],
          ["log", "Log"],
        ]}
        cur={tab}
        set={setTab}
      />
      {tab === "ospf" && (
        <div className="space-y-2 p-3">
          <p className="text-[12.5px] text-pv-text-muted">Router ID {RID[r]}. A neighbor forms only when both ends run OSPF, neither is passive, and area + hello/dead match; FULL also needs the same MTU. Cost counts when traffic LEAVES through the interface.</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[12px]">
              <thead className="text-[11px] text-pv-text-faint">
                <tr>
                  <th className="px-1.5 py-1">interface</th>
                  <th className="px-1.5 py-1">in OSPF · area</th>
                  <th className="px-1.5 py-1">cost</th>
                  <th className="px-1.5 py-1">passive</th>
                  <th className="px-1.5 py-1">hello/dead · MTU</th>
                  <th className="px-1.5 py-1">neighbor</th>
                  <th className="px-1.5 py-1" />
                </tr>
              </thead>
              <tbody>
                {OS_IFS.map((i) => {
                  const ic = rc.ifs[i];
                  const l = linkOf(r, i);
                  const adj = l ? s.view.adj[l] : undefined;
                  const p = peerOf(r, i);
                  return (
                    <tr key={i} className="border-t border-pv-border/50 align-top">
                      <td className="pv-mono whitespace-nowrap px-1.5 py-1 text-pv-text">
                        {osIfName(c.vendor, i)} <span className="font-sans text-[11px] text-pv-text-faint">{IF_ADDR[r][i].ip}/{IF_ADDR[r][i].prefix}</span>
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-1">
                        <input type="checkbox" checked={ic.ospf} aria-label={`${r} ${i} in OSPF`} onChange={(e) => setIf(i, { ospf: e.target.checked }, e.target.checked ? "into OSPF" : "out of OSPF")} />{" "}
                        <select aria-label={`${r} ${i} area`} className={sel} value={ic.area} disabled={!ic.ospf} onChange={(e) => setIf(i, { area: +e.target.value }, `area ${e.target.value}`)}>
                          <option value={0}>area 0</option>
                          <option value={1}>area 1</option>
                        </select>
                      </td>
                      <td className="px-1.5 py-1">
                        {i === "lo0" ? (
                          <span className="pv-mono text-pv-text-faint">1</span>
                        ) : (
                          <select aria-label={`${r} ${i} cost`} className={sel} value={ic.cost} onChange={(e) => setIf(i, { cost: +e.target.value }, `cost ${e.target.value}`)}>
                            {[...new Set([1, 5, 10, 15, 20, 100, ic.cost])].sort((a, b) => a - b).map((v) => (
                              <option key={v} value={v}>
                                {v}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="px-1.5 py-1">
                        <input type="checkbox" checked={ic.passive} aria-label={`${r} ${i} passive`} onChange={(e) => setIf(i, { passive: e.target.checked }, e.target.checked ? "passive" : "not passive")} />
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-1">
                        <select aria-label={`${r} ${i} timers`} className={sel} value={`${ic.hello}/${ic.dead}`} onChange={(e) => setIf(i, { hello: +e.target.value.split("/")[0], dead: +e.target.value.split("/")[1] }, `hello/dead ${e.target.value}`)}>
                          <option value="10/40">10/40</option>
                          <option value="5/20">5/20</option>
                        </select>{" "}
                        <select aria-label={`${r} ${i} MTU`} className={sel} value={ic.mtu} onChange={(e) => setIf(i, { mtu: +e.target.value }, `MTU ${e.target.value}`)}>
                          <option value={1500}>1500</option>
                          <option value={1400}>1400</option>
                        </select>
                      </td>
                      <td className="px-1.5 py-1 text-[11.5px]">{p ? <span className={clsx("pv-mono font-bold", ST_TONE[adj?.state ?? "DOWN"])}>{p.r} {adj?.state}</span> : <span className="text-pv-text-faint">{i === "ge-0/0/0" ? HOST_OF_TEXT(r) : "—"}</span>}{adj?.why && <span className="block text-pv-text-muted">{adj.why}</span>}</td>
                      <td className="whitespace-nowrap px-1.5 py-1">
                        {i !== "lo0" && (
                          <button type="button" className={btn} onClick={() => setIf(i, { shut: !ic.shut }, ic.shut ? "enabled" : "disabled")}>
                            {ic.shut ? "Enable" : "Disable"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {tab === "routes" && (
        <div className="space-y-2 p-3">
          <table className="w-full text-left text-[12px]">
            <thead className="text-[11px] text-pv-text-faint">
              <tr>
                <th className="px-1.5 py-1">prefix</th>
                <th className="px-1.5 py-1">source</th>
                <th className="px-1.5 py-1">[AD/metric]</th>
                <th className="px-1.5 py-1">next hop</th>
              </tr>
            </thead>
            <tbody className="pv-mono">
              {fib.used.filter((x) => x.proto !== "L").map((x) => (
                <tr key={`${routeText(x)}${x.proto}`} className={clsx("border-t border-pv-border/50", x.proto === "S" && "text-pv-warning")}>
                  <td className="px-1.5 py-0.5">{routeText(x)}</td>
                  <td className="px-1.5 py-0.5">{x.proto === "O" ? "OSPF" : x.proto === "S" ? "static" : "connected"}</td>
                  <td className="px-1.5 py-0.5">{x.proto === "C" ? "—" : `[${x.ad}/${x.metric}]`}</td>
                  <td className="px-1.5 py-0.5">{x.hops.map((h) => (h.nh ? `${h.nh} (${osIfName(c.vendor, h.via)})` : osIfName(c.vendor, h.via))).join(" · ")}</td>
                </tr>
              ))}
              {fib.hidden.map((x) => (
                <tr key={`h${routeText(x)}${x.proto}`} className="border-t border-pv-border/50 text-pv-text-faint line-through">
                  <td className="px-1.5 py-0.5">{routeText(x)}</td>
                  <td className="px-1.5 py-0.5">{x.proto === "O" ? "OSPF" : "static"} (not used)</td>
                  <td className="px-1.5 py-0.5">[{x.ad}/{x.metric}]</td>
                  <td className="px-1.5 py-0.5">{x.hops.map((h) => h.nh).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11.5px] text-pv-text-muted">For the same prefix the lowest administrative distance wins: connected 0, static 1, OSPF 110 (Junos: static 5, OSPF 10). Struck-through routes are known but not used.</p>
          <div className="flex flex-wrap gap-1">
            {rc.statics.map((x) => (
              <button
                key={`${x.prefix}`}
                type="button"
                className={btn}
                onClick={() => {
                  const n = osClone(s.cfg);
                  n.r[r].statics = n.r[r].statics.filter((y) => y.prefix !== x.prefix || y.len !== x.len);
                  c.act({ type: "cfg", cfg: n, text: `${r}: static route ${x.prefix}/${x.len} removed` });
                }}
              >
                Remove static {x.prefix}/{x.len} → {x.nh}
              </button>
            ))}
          </div>
        </div>
      )}
      {tab === "lsdb" && (
        <div className="space-y-2 p-3 text-[12px]">
          {s.view.lsdb[r].map((l) => (
            <div key={l.origin} className="rounded-lg border border-pv-border p-2">
              <p className="font-semibold text-pv-text">
                {l.origin} ({RID[l.origin]}) · seq 0x{(0x80000000 + l.seq).toString(16)}
              </p>
              <p className="pv-mono text-pv-text-muted">links: {l.links.map((x) => `${x.nbr} (cost ${x.cost})`).join(", ") || "none"}</p>
              <p className="pv-mono text-pv-text-muted">networks: {l.stubs.map((x) => `${x.net}/${x.len}`).join(", ")}</p>
            </div>
          ))}
          <p className="text-[11.5px] text-pv-text-muted">{s.view.lsdb[r].length === 4 ? "All four routers' LSAs: the same database every router in the area holds." : "Some LSAs are missing: this router has no FULL path to every router."}</p>
        </div>
      )}
      {tab === "term" && <DevConsole c={c} dev={r} />}
      {tab === "cap" && <CaptureView s={s} points={OS_IFS.filter((i) => i !== "lo0").map((i) => `${r} ${i}`)} initial={`${r} ge-0/0/1`} vendor={c.vendor} />}
      {tab === "log" && (
        <div className="space-y-1 p-3 text-[12.5px]">
          {logs.length === 0 ? (
            <p className="text-pv-text-faint">No events.</p>
          ) : (
            logs.slice(-40).map((x, k) => (
              <p key={k} className={clsx("pv-mono text-[12px]", x.ev === "mismatch" || x.to === "DOWN" ? "text-pv-danger" : x.to === "EXSTART" ? "text-pv-warning" : "text-pv-text-muted")}>
                t={x.clock - 10800}s · {osIfName(c.vendor, x.ifn)} {x.ev === "adj" ? `neighbor ${x.nbr}: ${x.from} → ${x.to}${x.text ? ` (${x.text})` : ""}` : x.ev === "mismatch" ? x.text : `link ${x.ev}`}
              </p>
            ))
          )}
        </div>
      )}
    </>
  );
}
const HOST_OF_TEXT = (r: OsRouter) => `LAN (${OS_HOSTS.find((h) => ROUTER_OF[h] === r)})`;
function HostUI({ c, h }: { c: OsDeskCtx; h: OsHost }) {
  const [tab, setTab] = useState<"send" | "shell" | "cap">("send");
  const others = OS_HOSTS.filter((x) => x !== h);
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
          <Kv k="IPv4 · gateway" v={`${HOST_IP[h]}/24 · ${IF_ADDR[ROUTER_OF[h]]["ge-0/0/0"].ip} (${ROUTER_OF[h]})`} />
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
      {tab === "cap" && <CaptureView s={c.view} points={[h]} vendor={c.vendor} />}
    </>
  );
}
function Win({ w, c, narrow, focused, onFocus, onMove, onMin, onClose }: { w: OsWin; c: OsDeskCtx; narrow: boolean; focused: boolean; onFocus: () => void; onMove: (x: number, y: number) => void; onMin: () => void; onClose: () => void }) {
  const drag = useRef<{ dx: number; dy: number } | undefined>(undefined);
  const tone = isRouter(w.id) ? "#f59e0b" : "#34d399";
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
          <p className="truncate text-[13.5px] font-bold text-pv-text">{w.id}</p>
          <p className="truncate text-[11px] text-pv-text-faint">{isRouter(w.id) ? `Router ${RID[w.id]} · ${c.vendor === "cisco" ? "Cisco IOS" : "Junos"} view` : `${HOST_IP[w.id as OsHost]} · Linux`}</p>
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
      <div className="min-h-0 flex-1 overflow-y-auto">{isRouter(w.id) ? <RouterUI c={c} r={w.id} /> : <HostUI c={c} h={w.id as OsHost} />}</div>
    </section>
  );
}
export function OsDesk({ windows, setWindows, focus, setFocus, ctx }: { windows: OsWin[]; setWindows: (u: (w: OsWin[]) => OsWin[]) => void; focus?: OsDev; setFocus: (n: OsDev | undefined) => void; ctx: OsDeskCtx }) {
  const narrow = useNarrow();
  if (typeof document === "undefined" || !windows.length) return null;
  const top = Math.max(0, ...windows.map((w) => w.z));
  const raise = (id: OsDev) => {
    setFocus(id);
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, z: top + 1, minimized: false } : w)));
  };
  const minimize = (id: OsDev) => (setWindows((ws) => ws.map((v) => (v.id === id ? { ...v, minimized: true } : v))), setFocus(undefined));
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
export function openOsWindow(ws: OsWin[], id: OsDev): OsWin[] {
  const top = Math.max(0, ...ws.map((w) => w.z));
  if (ws.some((w) => w.id === id)) return ws.map((w) => (w.id === id ? { ...w, minimized: false, z: top + 1 } : w));
  const n = ws.length;
  const x = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerWidth - 920, 40 + n * 36));
  const y = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerHeight - 660, 90 + n * 30));
  return [...ws, { id, minimized: false, x, y, z: top + 1 }];
}
