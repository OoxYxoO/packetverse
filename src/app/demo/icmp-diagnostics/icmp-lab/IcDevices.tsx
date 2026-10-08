"use client";

import { clsx } from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CliVendor } from "@/lib/cli/types";
import { IC_KIND, IC_POINTS, icCiscoIf, icClone, icJunosIf, icPointLabel, icPktText, icRouteTable, icShortIf, type IcAction, type IcCap, type IcDev, type IcHost, type IcIf, type IcPoint, type IcRouter, type IcRouterCfg, type IcState } from "@/lib/sim-engine/scenarios/icmpNet";
import { ConsoleTerminal, EMPTY_SESSION, type ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { icHostSet, icJunosConfig, icRouterSets, type IcCiscoMode, type IcCliApi, type IcCommit } from "./icCli";

/**
 * ICMP lab devices, Packet Tracer style (drag, minimize to a tray, resize; full screen on phones).
 *   HOST-A / HOST-B: what the host is (address, gateway, interface MTU, the path MTUs it has learnt), its terminal and a
 *   capture of its eth0. HOST-B also has its power switch and its firewall rules.
 *   R1 / R2: interfaces (address, IP MTU, state, counters, giants, filter), the routing table, ICMP statistics and filter
 *   hit counters, a Cisco/Junos console, and a capture per interface.
 * Every number is read from the lab state; every change goes through the model.
 */

export interface IcDeskCtx {
  view: IcState;
  act: (a: IcAction) => IcState;
  vendor: CliVendor;
  setVendor: (v: CliVendor) => void;
  cisco: Record<IcRouter, IcCiscoMode>;
  setCisco: (r: IcRouter, m: IcCiscoMode) => void;
  junosEdit: Record<IcRouter, boolean>;
  setJunosEdit: (r: IcRouter, b: boolean) => void;
  cand: Record<IcRouter, IcRouterCfg>;
  setCand: (r: IcRouter, c: IcRouterCfg) => void;
  hist: Record<IcRouter, IcCommit[]>;
  commit: (r: IcRouter, c: IcRouterCfg) => void;
  question?: CliQuestion;
  setQuestion: (q: CliQuestion | undefined) => void;
  consoles: Record<string, ConsoleSession>;
  setConsoles: (u: (m: Record<string, ConsoleSession>) => Record<string, ConsoleSession>) => void;
  notes: boolean;
  setNotes: (b: boolean) => void;
}
export interface IcWin {
  id: IcDev;
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
const Kv = ({ k, v, tone }: { k: string; v: ReactNode; tone?: "warn" | "bad" }) => (
  <div className="flex justify-between gap-3 border-b border-pv-border/50 py-1 text-[12.5px]">
    <span className="text-pv-text-muted">{k}</span>
    <span className={clsx("pv-mono text-right", tone === "bad" ? "text-pv-danger" : tone === "warn" ? "text-pv-warning" : "text-pv-text")}>{v}</span>
  </div>
);

/** A capture at one observation point: every packet seen, both directions, with the device's own drop notes. */
export function CaptureView({ s, points, vendor, initial }: { s: IcState; points: IcPoint[]; vendor: CliVendor; initial?: IcPoint }) {
  const [point, setPoint] = useState<IcPoint>(initial ?? points[0]);
  const [onlyLast, setOnlyLast] = useState(true);
  const [pick, setPick] = useState<IcCap | undefined>(undefined);
  const rows = s.captures.filter((c) => c.point === point && (!onlyLast || !s.last || c.n >= s.last.capFrom)).slice(-60);
  return (
    <div className="space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-pv-text-muted">
        {points.length > 1 &&
          points.map((p) => (
            <button key={p} type="button" aria-pressed={point === p} onClick={() => (setPoint(p), setPick(undefined))} className={clsx("rounded-full border px-2.5 py-0.5 font-semibold", point === p ? "border-pv-cyan bg-pv-cyan/15 text-pv-text" : "border-pv-border")}>
              {icPointLabel(p, vendor)}
            </button>
          ))}
        <label className="ml-auto flex items-center gap-1">
          <input type="checkbox" checked={onlyLast} onChange={(e) => setOnlyLast(e.target.checked)} /> last test only
        </label>
      </div>
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-pv-text-faint">Nothing captured on {icPointLabel(point, vendor)}{onlyLast ? " during the last test" : ""}. Silence here is evidence too: the packet never crossed this interface.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[12px]">
            <thead className="text-[11px] text-pv-text-faint">
              <tr>
                <th className="px-1.5 py-1">#</th>
                <th className="px-1.5 py-1">dir</th>
                <th className="px-1.5 py-1">source → destination</th>
                <th className="px-1.5 py-1">what</th>
                <th className="px-1.5 py-1">TTL</th>
                <th className="px-1.5 py-1">len</th>
                <th className="px-1.5 py-1">DF</th>
              </tr>
            </thead>
            <tbody className="pv-mono">
              {rows.map((c) => (
                <tr key={c.n} onClick={() => setPick(c)} className={clsx("cursor-pointer border-t border-pv-border/50 hover:bg-white/[0.03]", pick?.n === c.n && "bg-pv-cyan/10", c.note && "text-pv-danger")}>
                  <td className="px-1.5 py-0.5">{c.n}</td>
                  <td className="px-1.5 py-0.5">{c.dir}</td>
                  <td className="px-1.5 py-0.5">
                    {c.pkt.src} → {c.pkt.dst}
                  </td>
                  <td className="px-1.5 py-0.5">
                    {icPktText(c.pkt)}
                    {c.pkt.frags ? ` [${c.pkt.frags} frags]` : ""}
                    {c.note ? " ✕" : ""}
                  </td>
                  <td className="px-1.5 py-0.5">{c.pkt.ttl}</td>
                  <td className="px-1.5 py-0.5">{c.pkt.len}</td>
                  <td className="px-1.5 py-0.5">{c.pkt.df ? "DF" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pick && (
        <div className="rounded-xl border border-pv-border bg-pv-bg/60 p-2.5 text-[12.5px]">
          <p className="font-semibold text-pv-text">
            #{pick.n} on {icPointLabel(pick.point, vendor)} ({pick.dir === "in" ? "received" : "sent"})
          </p>
          <div className="mt-1 grid gap-x-4 sm:grid-cols-2">
            <Kv k="IPv4 source" v={pick.pkt.src} />
            <Kv k="IPv4 destination" v={pick.pkt.dst} />
            <Kv k="TTL" v={pick.pkt.ttl} />
            <Kv k="Total length" v={`${pick.pkt.len} B`} />
            <Kv k="DF (Don't Fragment)" v={pick.pkt.df ? "1 — set" : "0"} />
            <Kv k="Protocol" v={pick.pkt.proto === "icmp" ? "1 (ICMP)" : pick.pkt.proto === "udp" ? `17 (UDP), dst port ${pick.pkt.dport}` : `6 (TCP) ${pick.pkt.tcp}`} />
            {pick.pkt.proto === "icmp" && <Kv k="ICMP type / code" v={`${IC_KIND[pick.pkt.kind!].type} / ${IC_KIND[pick.pkt.kind!].code} — ${IC_KIND[pick.pkt.kind!].name}`} />}
            {pick.pkt.mtu && <Kv k="Next-hop MTU" v={pick.pkt.mtu} tone="warn" />}
            {pick.pkt.frags && <Kv k="Carried as" v={`${pick.pkt.frags} fragments`} />}
          </div>
          {pick.pkt.quote && (
            <p className="mt-1.5 text-pv-text-muted">
              Quoted original (the packet this error is about): <span className="pv-mono text-pv-text">{pick.pkt.quote.src} → {pick.pkt.quote.dst}, {pick.pkt.quote.proto === "icmp" ? IC_KIND[pick.pkt.quote.kind!].short : `${pick.pkt.quote.proto.toUpperCase()}${pick.pkt.quote.dport ? ` :${pick.pkt.quote.dport}` : ""}`}, TTL {pick.pkt.quote.ttl}, {pick.pkt.quote.len} B</span>
            </p>
          )}
          {pick.note && <p className="mt-1.5 font-semibold text-pv-danger">{pick.note}</p>}
        </div>
      )}
    </div>
  );
}

function Terminal({ c, dev }: { c: IcDeskCtx; dev: IcDev }) {
  const host = dev === "HOST-A" || dev === "HOST-B";
  const r = dev as IcRouter;
  const os = host ? "linux" : c.vendor === "cisco" ? "ios" : "junos";
  const key = `${dev}:${os}`;
  const history = c.consoles[key]?.history ?? [];
  const api: IcCliApi | undefined = host ? undefined : { view: c.view, act: c.act, history, cisco: c.cisco[r], setCisco: (m) => c.setCisco(r, m), junosEdit: c.junosEdit[r], setJunosEdit: (b) => c.setJunosEdit(r, b), cand: c.cand[r], setCand: (x) => c.setCand(r, x), hist: c.hist[r], commit: (x) => c.commit(r, x), ask: c.setQuestion };
  const hostApi: IcCliApi = { view: c.view, act: c.act, history, cisco: { kind: "exec" }, setCisco: () => undefined, junosEdit: false, setJunosEdit: () => undefined, cand: c.view.cfg.R1, setCand: () => undefined, hist: [], commit: () => undefined };
  if (host && !c.view.cfg[dev as IcHost].power) return <p className="p-4 text-[13px] text-pv-text-muted">{dev} is powered off. Nothing to log in to.</p>;
  return (
    <ConsoleTerminal
      key={key}
      sets={host ? { cisco: icHostSet(hostApi, dev as IcHost) } : icRouterSets(api!, r)}
      vendor={host ? "cisco" : c.vendor}
      setVendor={host ? undefined : c.setVendor}
      os={os}
      host={dev}
      session={c.consoles[key] ?? EMPTY_SESSION}
      setSession={(u) => c.setConsoles((m) => ({ ...m, [key]: u(m[key] ?? EMPTY_SESSION) }))}
      notes={c.notes}
      setNotes={c.setNotes}
      question={!host ? c.question : undefined}
      pipeCtx={!host ? { config: icJunosConfig(c.hist[r]), rollbacks: c.hist[r].length } : undefined}
      className="h-[min(440px,58vh)]"
    />
  );
}

function HostUI({ c, h }: { c: IcDeskCtx; h: IcHost }) {
  const [tab, setTab] = useState<"status" | "term" | "cap">("status");
  const cfg = c.view.cfg[h];
  const setPower = (on: boolean) => {
    const net = icClone(c.view.cfg);
    net[h].power = on;
    c.act({ type: "cfg", cfg: net, text: `${h} powered ${on ? "on" : "off"}` });
  };
  return (
    <>
      <Tabs tabs={[["status", "Status"], ["term", "Terminal"], ["cap", "Capture eth0"]]} cur={tab} set={setTab} />
      {tab === "term" ? (
        <Terminal c={c} dev={h} />
      ) : tab === "cap" ? (
        <CaptureView s={c.view} points={[h]} vendor={c.vendor} />
      ) : (
        <div className="space-y-2 p-3">
          <div className="grid gap-x-6 sm:grid-cols-2">
            <Kv k="Power" v={cfg.power ? "on" : "OFF"} tone={cfg.power ? undefined : "bad"} />
            <Kv k="eth0" v={`${cfg.ip}/${cfg.prefix}`} />
            <Kv k="Default gateway" v={cfg.gw} />
            <Kv k="Interface MTU" v={cfg.mtu} />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-pv-text-faint">Path MTUs learnt (from ICMP 3/4)</p>
            {Object.keys(cfg.pmtu).length ? (
              Object.entries(cfg.pmtu).map(([d, m]) => <Kv key={d} k={`to ${d}`} v={m} tone="warn" />)
            ) : (
              <p className="text-[12.5px] text-pv-text-muted">None — packets use the interface MTU until a router reports something smaller.</p>
            )}
          </div>
          {h === "HOST-B" && (
            <>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-pv-text-faint">Firewall (iptables INPUT, policy ACCEPT)</p>
                {cfg.input.length ? cfg.input.map((r, i) => <Kv key={i} k={`${i + 1}. icmp ${r.type}`} v={r.target} tone={r.target === "DROP" ? "bad" : undefined} />) : <p className="text-[12.5px] text-pv-text-muted">No rules: everything is accepted.</p>}
                <p className="mt-1 text-[12px] text-pv-text-faint">Change them in the Terminal (sudo iptables -L / -D / -I).</p>
              </div>
              <button type="button" onClick={() => setPower(!cfg.power)} className={clsx("rounded-full px-4 py-1.5 text-[13px] font-semibold", cfg.power ? "border border-pv-danger/60 text-pv-danger" : "bg-pv-success text-[#03131a]")}>
                {cfg.power ? "Power off" : "Power on"}
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}

function RouterUI({ c, r }: { c: IcDeskCtx; r: IcRouter }) {
  const [tab, setTab] = useState<"ifs" | "routes" | "icmp" | "console" | "cap">("ifs");
  const s = c.view;
  const cfg = s.cfg[r];
  const ifName = (i: IcIf) => (c.vendor === "cisco" ? icShortIf(i) : icJunosIf(i));
  const pts = IC_POINTS.filter((p) => p.startsWith(r));
  const st = s.stats[r];
  const sum = (o: Partial<Record<string, number>>) => Object.values(o).reduce((a: number, b) => a + (b ?? 0), 0);
  return (
    <>
      <Tabs tabs={[["ifs", "Interfaces"], ["routes", "Routes"], ["icmp", "ICMP & filters"], ["console", "Console"], ["cap", "Capture"]]} cur={tab} set={setTab} />
      {tab === "console" ? (
        <Terminal c={c} dev={r} />
      ) : tab === "cap" ? (
        <CaptureView s={s} points={pts} vendor={c.vendor} />
      ) : tab === "routes" ? (
        <div className="p-3">
          <table className="w-full text-left text-[12.5px]">
            <thead className="text-[11px] text-pv-text-faint">
              <tr>
                <th className="py-1">Destination</th>
                <th className="py-1">Type</th>
                <th className="py-1">Via</th>
              </tr>
            </thead>
            <tbody className="pv-mono">
              {icRouteTable(cfg).map((x, i) => (
                <tr key={i} className={clsx("border-t border-pv-border/50", !x.active && "text-pv-text-faint line-through")}>
                  <td className="py-0.5">
                    {x.prefix}/{x.len}
                  </td>
                  <td className="py-0.5">{x.kind}</td>
                  <td className="py-0.5">{x.via ? `${x.via} (${x.iface ? ifName(x.iface) : "unresolved"})` : x.iface ? ifName(x.iface) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[12px] text-pv-text-faint">A router can only reply to — or report errors to — networks it has a route to. Its ICMP messages need a return path like any packet.</p>
        </div>
      ) : tab === "icmp" ? (
        <div className="space-y-2 p-3">
          <div className="grid gap-x-6 sm:grid-cols-2">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-pv-text-faint">ICMP sent ({sum(st.sent)})</p>
              {(Object.keys(IC_KIND) as (keyof typeof IC_KIND)[]).filter((k) => st.sent[k]).map((k) => <Kv key={k} k={`${IC_KIND[k].type}/${IC_KIND[k].code} ${IC_KIND[k].short}`} v={st.sent[k]} />)}
              {!sum(st.sent) && <p className="text-[12.5px] text-pv-text-muted">None yet.</p>}
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-pv-text-faint">ICMP received for {r} ({sum(st.rcvd)})</p>
              {(Object.keys(IC_KIND) as (keyof typeof IC_KIND)[]).filter((k) => st.rcvd[k]).map((k) => <Kv key={k} k={`${IC_KIND[k].type}/${IC_KIND[k].code} ${IC_KIND[k].short}`} v={st.rcvd[k]} />)}
              {!sum(st.rcvd) && <p className="text-[12.5px] text-pv-text-muted">None yet.</p>}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-pv-text-faint">Filter WAN-IN {cfg.acl?.appliedIn ? `(inbound on ${ifName(cfg.acl.appliedIn)})` : "(not applied)"}</p>
            {cfg.acl?.entries.length ? cfg.acl.entries.map((e) => <Kv key={e.seq} k={`${e.seq} ${e.action} ${e.proto}${e.icmp ? ` ${e.icmp}` : ""}`} v={`${e.hits} hits`} tone={e.action === "deny" && e.hits ? "bad" : undefined} />) : <p className="text-[12.5px] text-pv-text-muted">No filter on {r}.</p>}
          </div>
        </div>
      ) : (
        <div className="space-y-2 p-3">
          <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-pv-text-muted">
            OS view:
            {(["cisco", "juniper"] as CliVendor[]).map((v) => (
              <button key={v} type="button" aria-pressed={c.vendor === v} onClick={() => c.setVendor(v)} className={clsx("rounded-full border px-2.5 py-0.5 font-semibold", c.vendor === v ? "border-pv-cyan bg-pv-cyan/15 text-pv-text" : "border-pv-border")}>
                {v === "cisco" ? "Cisco IOS" : "Junos"}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[12.5px]">
              <thead className="text-[11px] text-pv-text-faint">
                <tr>
                  <th className="px-1.5 py-1">Interface</th>
                  <th className="px-1.5 py-1">Address</th>
                  <th className="px-1.5 py-1">IP MTU</th>
                  <th className="px-1.5 py-1">State</th>
                  <th className="px-1.5 py-1">In / Out</th>
                  <th className="px-1.5 py-1">Drops</th>
                </tr>
              </thead>
              <tbody className="pv-mono">
                {(["ge0", "ge1"] as IcIf[]).map((i) => {
                  const k = s.counters[`${r}:${i}` as IcPoint];
                  const f = cfg.ifs[i];
                  return (
                    <tr key={i} className="border-t border-pv-border/50">
                      <td className="px-1.5 py-0.5 text-pv-text">
                        {c.vendor === "cisco" ? icCiscoIf(i) : icJunosIf(i)}
                        <span className="block font-sans text-[11px] text-pv-text-faint">{i === "ge1" ? "transit" : r === "R1" ? "LAN-A" : "LAN-B"}</span>
                      </td>
                      <td className="px-1.5 py-0.5">
                        {f.ip}/{f.prefix}
                      </td>
                      <td className={clsx("px-1.5 py-0.5", f.mtu < 1500 && "text-pv-warning")}>{f.mtu}</td>
                      <td className={clsx("px-1.5 py-0.5", !f.up && "text-pv-danger")}>{f.up ? "up" : "admin down"}</td>
                      <td className="px-1.5 py-0.5">
                        {k.in} / {k.out}
                      </td>
                      <td className={clsx("px-1.5 py-0.5", (k.aclDrops || k.giants) && "text-pv-danger")}>
                        {k.aclDrops ? `${k.aclDrops} filter` : ""}
                        {k.giants ? ` ${k.giants} giants` : ""}
                        {cfg.acl?.appliedIn === i ? <span className="block font-sans text-[11px] text-pv-text-faint">WAN-IN inbound</span> : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-pv-text-faint">Change settings in the Console (IOS: configure terminal → interface … · Junos: configure → set … → commit). Then verify here and send a fresh probe.</p>
        </div>
      )}
    </>
  );
}

function Win({ w, c, narrow, focused, onFocus, onMove, onMin, onClose }: { w: IcWin; c: IcDeskCtx; narrow: boolean; focused: boolean; onFocus: () => void; onMove: (x: number, y: number) => void; onMin: () => void; onClose: () => void }) {
  const drag = useRef<{ dx: number; dy: number } | undefined>(undefined);
  const host = w.id === "HOST-A" || w.id === "HOST-B";
  const cfg = c.view.cfg;
  const sub = host ? `Linux · ${cfg[w.id as IcHost].ip} · ${cfg[w.id as IcHost].power ? "on" : "powered off"}` : `Router · ${c.vendor === "cisco" ? "Cisco IOS" : "Junos"} view`;
  const tone = host ? "#34d399" : "#22d3ee";
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
      style={narrow ? { zIndex: 100 + w.z } : { left: w.x, top: w.y, width: "min(760px, calc(100vw - 32px))", height: "min(600px, calc(100vh - 96px))", zIndex: 100 + w.z, resize: "both" }}
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
        <span className="flex h-7 w-7 items-center justify-center rounded-lg border text-[13px] font-bold" style={{ borderColor: tone, color: tone }} aria-hidden>
          {host ? "💻" : "R"}
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
      <div className="min-h-0 flex-1 overflow-y-auto">{host ? <HostUI c={c} h={w.id as IcHost} /> : <RouterUI c={c} r={w.id as IcRouter} />}</div>
    </section>
  );
}

export function IcDesk({ windows, setWindows, focus, setFocus, ctx }: { windows: IcWin[]; setWindows: (u: (w: IcWin[]) => IcWin[]) => void; focus?: IcDev; setFocus: (n: IcDev | undefined) => void; ctx: IcDeskCtx }) {
  const narrow = useNarrow();
  if (typeof document === "undefined" || !windows.length) return null;
  const top = Math.max(0, ...windows.map((w) => w.z));
  const raise = (id: IcDev) => {
    setFocus(id);
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, z: top + 1, minimized: false } : w)));
  };
  const minimize = (id: IcDev) => (setWindows((ws) => ws.map((v) => (v.id === id ? { ...v, minimized: true } : v))), setFocus(undefined));
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

export function openIcWindow(ws: IcWin[], id: IcDev): IcWin[] {
  const top = Math.max(0, ...ws.map((w) => w.z));
  if (ws.some((w) => w.id === id)) return ws.map((w) => (w.id === id ? { ...w, minimized: false, z: top + 1 } : w));
  const n = ws.length;
  const x = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerWidth - 780, 40 + n * 36));
  const y = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerHeight - 620, 90 + n * 30));
  return [...ws, { id, minimized: false, x, y, z: top + 1 }];
}
