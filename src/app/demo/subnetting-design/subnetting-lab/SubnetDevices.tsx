"use client";

import { clsx } from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CliVendor } from "@/lib/cli/types";
import { maskOf } from "@/lib/sim-engine/scenarios/subnettingDesign";
import { ssCheck, ssCiscoIf, ssDevice, ssDevName, ssJunosIf, ssMatch, ssNetOf, ssParent, ssParseIp, ssShortIf, type SsAction, type SsState } from "@/lib/sim-engine/scenarios/subnetStudio";
import { ConsoleTerminal, EMPTY_SESSION, type ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { ssHostSet, ssJunosConfig, ssR1Sets, type SsCliApi } from "./ssCli";

/**
 * Subnet Studio devices, Packet Tracer style: R1 and every network's device open in their own window (drag, minimize
 * to a tray; full screen on phones). The windows exist for one question — does this device's addressing match the
 * design? A device shows what it BELIEVES (its network, range, broadcast and whether its gateway is on that network,
 * computed from its own address and mask) next to what the PLAN says, its settings, and a terminal. R1 shows each
 * interface's connected subnet against its block in the plan, and a Cisco/Junos console.
 */

export type SsWinId = string;
export interface SsWin {
  id: SsWinId;
  minimized: boolean;
  x: number;
  y: number;
  z: number;
}
export interface SsDeskCtx {
  view: SsState;
  act: (a: SsAction) => SsState;
  vendor: CliVendor;
  setVendor: (v: CliVendor) => void;
  cli: Omit<SsCliApi, "view" | "act" | "history" | "ask">;
  question?: CliQuestion;
  setQuestion: (q: CliQuestion | undefined) => void;
  consoles: Record<string, ConsoleSession>;
  setConsoles: (u: (m: Record<string, ConsoleSession>) => Record<string, ConsoleSession>) => void;
  notes: boolean;
  setNotes: (b: boolean) => void;
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
const prefixOfMask = (m: string) => {
  const t = m.trim().replace(/^\//, "");
  if (/^\d{1,2}$/.test(t)) return +t >= 8 && +t <= 30 ? +t : undefined;
  if (!ssParseIp(t)) return undefined;
  for (let p = 8; p <= 30; p++) if (maskOf(p) === t) return p;
  return undefined;
};
const Mono = ({ children, tone }: { children: ReactNode; tone?: "ok" | "bad" }) => <span className={clsx("pv-mono", tone === "ok" ? "text-pv-success" : tone === "bad" ? "text-pv-danger" : "text-pv-text")}>{children}</span>;

/** What a device believes, computed only from its own address, mask and gateway — beside what the plan says. */
export function Believes({ c, id }: { c: SsDeskCtx; id: string }) {
  const s = c.view;
  const d = ssDevice(s.needs, id)!;
  const wire = d.wire;
  const h = s.net.hosts[id] ?? {};
  const row = ssCheck(ssParent(s), s.needs, s.rows, wire);
  if (!h.ip || h.prefix === undefined) return <p className="p-3 text-[13px] text-pv-text-muted">{d.name} has no IPv4 address yet. Apply the plan, or give it settings.</p>;
  const net = ssNetOf(h.ip, h.prefix);
  const size = 2 ** (32 - h.prefix);
  const netN = net.split(".").reduce((a, o) => a * 256 + Number(o), 0);
  const ip = (x: number) => [24, 16, 8, 0].map((k) => Math.floor(x / 2 ** k) % 256).join(".");
  const gwOn = h.gw ? ssNetOf(h.gw, h.prefix) === net : false;
  const same = row && row.real === net && row.prefix === h.prefix;
  return (
    <div className="space-y-2 p-3 text-[13px]">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-pv-cyan/40 bg-pv-cyan/[0.05] p-2.5">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-pv-cyan-soft">{d.name} believes</p>
          <ul className="mt-1 space-y-0.5 text-pv-text-muted">
            <li>
              address <Mono>{h.ip}/{h.prefix}</Mono> <span className="text-pv-text-faint">({maskOf(h.prefix)})</span>
            </li>
            <li>
              {h.ip} AND {maskOf(h.prefix)} = <Mono>{net}</Mono>
            </li>
            <li>
              my network <Mono>{net}/{h.prefix}</Mono>: <Mono>{ip(netN + 1)}</Mono>–<Mono>{ip(netN + size - 2)}</Mono>, broadcast <Mono>{ip(netN + size - 1)}</Mono>
            </li>
            <li>
              gateway <Mono tone={h.gw ? (gwOn ? "ok" : "bad") : "bad"}>{h.gw ?? "none"}</Mono> {h.gw ? (gwOn ? "is on my network ✓" : `is NOT on my network (${h.gw} AND /${h.prefix} = ${ssNetOf(h.gw, h.prefix)})`) : "— remote traffic has nowhere to go"}
            </li>
          </ul>
        </div>
        <div className="rounded-xl border border-pv-violet/40 bg-pv-violet/[0.06] p-2.5">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-pv-violet">The plan says ({wire})</p>
          {row ? (
            <ul className="mt-1 space-y-0.5 text-pv-text-muted">
              <li>
                written <Mono>{row.written}/{row.prefix}</Mono>
              </li>
              <li>
                real block <Mono>{row.real}/{row.prefix}</Mono>
                {!row.aligned && <span className="text-pv-danger"> (written start is {row.rem} past the boundary)</span>}
              </li>
              <li>
                usable <Mono>{row.first}</Mono>–<Mono>{row.last}</Mono>, broadcast <Mono>{row.broadcast}</Mono>
              </li>
              <li>
                R1 here: <Mono>{s.net.r1[wire]?.ip ?? "unassigned"}</Mono>
              </li>
            </ul>
          ) : (
            <p className="mt-1 text-pv-text-muted">{wire} has no block in the plan yet.</p>
          )}
        </div>
      </div>
      <p className={clsx("rounded-lg px-2.5 py-1.5 text-[12.5px]", same && gwOn && h.gw === s.net.r1[wire]?.ip ? "bg-pv-success/10 text-pv-success" : "bg-pv-warning/10 text-pv-text")}>
        {same && gwOn && h.gw === s.net.r1[wire]?.ip ? "✓ What this device believes is exactly the block the plan gives it, and its gateway is R1's address there." : !row ? "No plan row to compare with." : !same ? `Mismatch: the device thinks its network is ${net}/${h.prefix}; the plan's block is ${row.real}/${row.prefix}. Every local/remote decision it makes follows ITS view.` : h.gw !== s.net.r1[wire]?.ip ? `Its network matches the plan, but its gateway (${h.gw ?? "none"}) is not R1's address on ${wire} (${s.net.r1[wire]?.ip ?? "unassigned"}).` : "Check the gateway."}
      </p>
    </div>
  );
}

function Settings({ c, id }: { c: SsDeskCtx; id: string }) {
  const cur = c.view.net.hosts[id] ?? {};
  const [ipT, setIp] = useState(cur.ip ?? "");
  const [maskT, setMask] = useState(cur.prefix !== undefined ? maskOf(cur.prefix) : "");
  const [gwT, setGw] = useState(cur.gw ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | undefined>(undefined);
  // The device can change from elsewhere (plan applied, a ticket): follow it, without losing the last message.
  const curKey = JSON.stringify(cur);
  const [seen, setSeen] = useState(curKey);
  if (seen !== curKey) {
    setSeen(curKey);
    setIp(cur.ip ?? "");
    setMask(cur.prefix !== undefined ? maskOf(cur.prefix) : "");
    setGw(cur.gw ?? "");
  }
  const save = () => {
    const ip = ssParseIp(ipT);
    const prefix = prefixOfMask(maskT);
    const gw = gwT.trim() ? ssParseIp(gwT) : undefined;
    if (!ip) return setMsg({ ok: false, text: `"${ipT}" is not an IPv4 address.` });
    if (prefix === undefined) return setMsg({ ok: false, text: `"${maskT}" is not a mask (use 255.255.255.192 or /26; /8–/30).` });
    if (gwT.trim() && !gw) return setMsg({ ok: false, text: `"${gwT}" is not an IPv4 address.` });
    const net = ssNetOf(ip, prefix);
    const bc = (() => {
      const n = net.split(".").reduce((a, o) => a * 256 + Number(o), 0) + 2 ** (32 - prefix) - 1;
      return [24, 16, 8, 0].map((k) => Math.floor(n / 2 ** k) % 256).join(".");
    })();
    if (ip === net || ip === bc) return setMsg({ ok: false, text: `${ip} is the ${ip === net ? "network" : "broadcast"} address of ${net}/${prefix}; a device can't use it.` });
    c.act({ type: "host-cfg", id, cfg: { ip, prefix, gw } });
    setMsg({ ok: true, text: "Accepted. Accepted only means the values are well-formed: check “What it believes”, then test with a ping." });
  };
  const field = (label: string, v: string, set: (s: string) => void, ph: string) => (
    <label className="block text-[12.5px] text-pv-text-muted">
      {label}
      <input value={v} onChange={(e) => set(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder={ph} className="mt-0.5 block h-9 w-full rounded-lg border border-pv-border bg-pv-bg px-2 pv-mono text-[14px] text-pv-text" />
    </label>
  );
  return (
    <div className="space-y-2 p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        {field("IPv4 address", ipT, setIp, "10.44.0.10")}
        {field("Subnet mask (or /prefix)", maskT, setMask, "255.255.255.128")}
        {field("Default gateway", gwT, setGw, "10.44.0.1")}
      </div>
      <button type="button" onClick={save} className="rounded-full bg-pv-cyan px-4 py-1.5 text-[13.5px] font-semibold text-[#03131a]">
        Apply settings
      </button>
      {msg && <p className={clsx("text-[12.5px]", msg.ok ? "text-pv-success" : "text-pv-danger")}>{msg.text}</p>}
    </div>
  );
}

function Terminal({ c, dev }: { c: SsDeskCtx; dev: string }) {
  const s = c.view;
  const host = dev !== "r1";
  const n = ssDevice(s.needs, dev);
  const os = host ? (n?.os === "windows" ? "windows" : "linux") : c.vendor === "cisco" ? "ios" : "junos";
  const key = `${dev}:${os}`;
  const api: SsCliApi = { ...c.cli, view: s, act: c.act, history: c.consoles[key]?.history ?? [], ask: c.setQuestion };
  return (
    <ConsoleTerminal
      key={key}
      sets={host ? { cisco: ssHostSet(api, dev) } : ssR1Sets(api)}
      vendor={host ? "cisco" : c.vendor}
      setVendor={host ? undefined : c.setVendor}
      os={os}
      host={ssDevName(s.needs, dev)}
      session={c.consoles[key] ?? EMPTY_SESSION}
      setSession={(u) => c.setConsoles((m) => ({ ...m, [key]: u(m[key] ?? EMPTY_SESSION) }))}
      notes={c.notes}
      setNotes={c.setNotes}
      question={!host ? c.question : undefined}
      pipeCtx={!host ? { config: ssJunosConfig(s, c.cli.hist), rollbacks: c.cli.hist.length } : undefined}
      className="h-[min(420px,55vh)]"
    />
  );
}

function HostUI({ c, id }: { c: SsDeskCtx; id: string }) {
  const n = ssDevice(c.view.needs, id)!;
  const [tab, setTab] = useState<"believe" | "settings" | "term">("believe");
  const tabs: ["believe" | "settings" | "term", string][] = [["believe", "What it believes"], ["settings", n.os === "router" ? "Interface settings" : "Network settings"]];
  if (n.os !== "router") tabs.push(["term", n.os === "windows" ? "Command Prompt" : "Terminal"]);
  return (
    <>
      <Tabs tabs={tabs} cur={tab} set={setTab} />
      {tab === "believe" ? <Believes c={c} id={id} /> : tab === "settings" ? <Settings c={c} id={id} /> : <Terminal c={c} dev={id} />}
      {n.os === "router" && tab !== "term" && <p className="px-3 pb-3 text-[12px] text-pv-text-muted">{n.name} is the router at the far end of {n.wire}. Its only route back is its default gateway: R1&apos;s address on this link.</p>}
    </>
  );
}

function R1UI({ c }: { c: SsDeskCtx }) {
  const s = c.view;
  const [tab, setTab] = useState<"ifs" | "cfg" | "console">("ifs");
  const parent = ssParent(s);
  const match = ssMatch(parent, s.needs, s.rows, s.net);
  return (
    <>
      <Tabs tabs={[["ifs", "Interfaces vs plan"], ["cfg", "Configure"], ["console", "Console"]]} cur={tab} set={setTab} />
      {tab === "console" ? (
        <Terminal c={c} dev="r1" />
      ) : tab === "cfg" ? (
        <R1Config c={c} />
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
            <table className="w-full min-w-[520px] text-left text-[12.5px]">
              <thead className="text-[11px] text-pv-text-faint">
                <tr>
                  <th className="px-2 py-1 font-semibold">Interface</th>
                  <th className="px-2 py-1 font-semibold">Address</th>
                  <th className="px-2 py-1 font-semibold">Connected subnet</th>
                  <th className="px-2 py-1 font-semibold">Plan block</th>
                  <th className="px-2 py-1 font-semibold">Match</th>
                </tr>
              </thead>
              <tbody className="pv-mono">
                {[...s.needs].sort((a, b) => a.iface - b.iface).map((n) => {
                  const i = s.net.r1[n.id];
                  const row = ssCheck(parent, s.needs, s.rows, n.id);
                  const m = match.find((x) => x.id === n.id)!;
                  return (
                    <tr key={n.id} className="border-t border-pv-border/60 align-top">
                      <td className="px-2 py-1 text-pv-text">
                        {c.vendor === "cisco" ? ssShortIf(n.iface) : ssJunosIf(n.iface)} <span className="font-sans text-[11px] text-pv-text-faint">{n.id}</span>
                      </td>
                      <td className="px-2 py-1">{i?.ip ? `${i.ip}/${i.prefix}` : "unassigned"}</td>
                      <td className="px-2 py-1">{i?.ip ? `${ssNetOf(i.ip, i.prefix!)}/${i.prefix}` : "—"}</td>
                      <td className="px-2 py-1">{row ? `${row.real}/${row.prefix}` : "—"}</td>
                      <td className={clsx("px-2 py-1 font-sans", m.r1.length ? "text-pv-danger" : "text-pv-success")}>{m.r1.length ? m.r1[0] : "✓"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-pv-text-muted">
            R1 can only deliver to addresses inside these connected subnets, so they must be exactly the blocks of the plan. Configure an interface in the Console ({c.vendor === "cisco" ? `interface ${ssCiscoIf(1)} → ip address … ` : `configure → set interfaces ${ssJunosIf(1)} unit 0 family inet address … → commit`}).
          </p>
        </div>
      )}
    </>
  );
}

/** R1's interfaces as a form (the GUI tab): the same rule as the CLI — R1 refuses an address whose subnet overlaps another interface. */
function R1Config({ c }: { c: SsDeskCtx }) {
  const s = c.view;
  return (
    <div className="space-y-2 p-3">
      <p className="text-[12.5px] text-pv-text-muted">One address per interface, inside the block your plan gives that network. The mask is what defines R1&apos;s connected subnet.</p>
      {[...s.needs].sort((a, b) => a.iface - b.iface).map((n) => (
        <IfRow key={n.id} c={c} id={n.id} />
      ))}
    </div>
  );
}
function IfRow({ c, id }: { c: SsDeskCtx; id: string }) {
  const s = c.view;
  const n = s.needs.find((x) => x.id === id)!;
  const cur = s.net.r1[id] ?? {};
  const [ipT, setIp] = useState(cur.ip ?? "");
  const [maskT, setMask] = useState(cur.prefix !== undefined ? maskOf(cur.prefix) : "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | undefined>(undefined);
  const curKey = JSON.stringify(cur);
  const [seen, setSeen] = useState(curKey);
  if (seen !== curKey) {
    setSeen(curKey);
    setIp(cur.ip ?? "");
    setMask(cur.prefix !== undefined ? maskOf(cur.prefix) : "");
  }
  const save = () => {
    const ip = ssParseIp(ipT);
    const prefix = prefixOfMask(maskT);
    if (!ip) return setMsg({ ok: false, text: `"${ipT}" is not an IPv4 address.` });
    if (prefix === undefined) return setMsg({ ok: false, text: `"${maskT}" is not a mask (255.255.255.192 or /26).` });
    const r = c.act({ type: "r1-if", id, ip, prefix, by: "GUI" });
    const refused = /refused/.test(r.last?.text ?? "");
    setMsg({ ok: !refused, text: refused ? (r.last!.text.split(": ").slice(1).join(": ") || r.last!.text) : `Accepted: connected subnet ${ssNetOf(ip, prefix)}/${prefix}.` });
  };
  return (
    <div className="rounded-xl border border-pv-border/70 p-2">
      <p className="text-[12.5px] font-semibold text-pv-text">
        {c.vendor === "cisco" ? ssShortIf(n.iface) : ssJunosIf(n.iface)} <span className="font-normal text-pv-text-muted">→ {n.id} ({n.what})</span>
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <input value={ipT} onChange={(e) => setIp(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="address" aria-label={`R1 ${n.id} address`} className="h-8 w-36 rounded-lg border border-pv-border bg-pv-bg px-2 pv-mono text-[13px] text-pv-text" />
        <input value={maskT} onChange={(e) => setMask(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="mask or /prefix" aria-label={`R1 ${n.id} mask`} className="h-8 w-36 rounded-lg border border-pv-border bg-pv-bg px-2 pv-mono text-[13px] text-pv-text" />
        <button type="button" onClick={save} className="h-8 rounded-lg bg-pv-cyan/80 px-2.5 text-[12.5px] font-semibold text-[#03131a]">
          Apply
        </button>
        {cur.ip && (
          <button type="button" onClick={() => (c.act({ type: "r1-if", id, by: "GUI" }), setMsg(undefined))} className="h-8 rounded-lg border border-pv-border px-2 text-[12px] text-pv-text-muted">
            Remove
          </button>
        )}
      </div>
      {msg && <p className={clsx("mt-1 text-[12px]", msg.ok ? "text-pv-success" : "text-pv-danger")}>{msg.text}</p>}
    </div>
  );
}

function Win({ w, c, narrow, focused, onFocus, onMove, onMin, onClose }: { w: SsWin; c: SsDeskCtx; narrow: boolean; focused: boolean; onFocus: () => void; onMove: (x: number, y: number) => void; onMin: () => void; onClose: () => void }) {
  const s = c.view;
  const drag = useRef<{ dx: number; dy: number } | undefined>(undefined);
  const n = ssDevice(s.needs, w.id);
  const name = ssDevName(s.needs, w.id);
  const h = s.net.hosts[w.id];
  const sub = w.id === "r1" ? `${s.needs.filter((x) => s.net.r1[x.id]?.ip).length}/${s.needs.length} interfaces addressed` : `${n?.os === "windows" ? "Windows" : n?.os === "router" ? "Router" : "Linux"} · ${h?.ip ? `${h.ip}/${h.prefix}` : "no address"} · gw ${h?.gw ?? "none"}`;
  const tone = w.id === "r1" ? "#22d3ee" : "#34d399";
  return (
    <section
      role="dialog"
      aria-label={`${name} window`}
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
          {w.id === "r1" || n?.os === "router" ? "R" : "💻"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-bold text-pv-text">
            {name} <span className="font-normal text-pv-text-muted">· {w.id === "r1" ? "Router" : n?.wire}</span>
          </p>
          <p className="truncate text-[11px] text-pv-text-faint">{sub}</p>
        </div>
        {!narrow && (
          <button type="button" onClick={onMin} aria-label={`Minimize ${name}`} className="rounded-md px-2 text-[14px] text-pv-text-faint hover:bg-white/10 hover:text-pv-text">
            –
          </button>
        )}
        <button type="button" onClick={onClose} aria-label={`Close ${name}`} className="rounded-md px-2 text-[14px] text-pv-text-faint hover:bg-pv-danger/20 hover:text-pv-text">
          ✕
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{w.id === "r1" ? <R1UI c={c} /> : n ? <HostUI c={c} id={w.id} /> : null}</div>
    </section>
  );
}

export function SsDesk({ windows, setWindows, focus, setFocus, ctx }: { windows: SsWin[]; setWindows: (u: (w: SsWin[]) => SsWin[]) => void; focus?: SsWinId; setFocus: (n: SsWinId | undefined) => void; ctx: SsDeskCtx }) {
  const narrow = useNarrow();
  if (typeof document === "undefined" || !windows.length) return null;
  const top = Math.max(0, ...windows.map((w) => w.z));
  const raise = (id: SsWinId) => {
    setFocus(id);
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, z: top + 1, minimized: false } : w)));
  };
  const minimize = (id: SsWinId) => (setWindows((ws) => ws.map((v) => (v.id === id ? { ...v, minimized: true } : v))), setFocus(undefined));
  const live = windows.filter((w) => w.id === "r1" || !!ssDevice(ctx.view.needs, w.id));
  return createPortal(
    <>
      {live.map((w) => (
        <Win key={w.id} w={w} c={ctx} narrow={narrow} focused={focus === w.id} onFocus={() => focus !== w.id && raise(w.id)} onMove={(x, y) => setWindows((ws) => ws.map((v) => (v.id === w.id ? { ...v, x, y } : v)))} onMin={() => minimize(w.id)} onClose={() => (setWindows((ws) => ws.filter((v) => v.id !== w.id)), setFocus(undefined))} />
      ))}
      <nav aria-label="Open devices" className="fixed bottom-3 left-1/2 z-[99] flex max-w-[calc(100vw-24px)] -translate-x-1/2 gap-1 overflow-x-auto rounded-full border border-pv-border bg-pv-bg/95 px-2 py-1 shadow-xl">
        {live.map((w) => (
          <button key={w.id} type="button" onClick={() => (w.minimized || focus !== w.id ? raise(w.id) : minimize(w.id))} className={clsx("flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold", !w.minimized && focus === w.id ? "bg-pv-cyan/20 text-pv-text" : "text-pv-text-muted hover:text-pv-text")}>
            {ssDevName(ctx.view.needs, w.id)}
            {w.minimized && <span className="text-[10px] text-pv-text-faint">(min)</span>}
          </button>
        ))}
      </nav>
    </>,
    document.body,
  );
}

export function openSsWindow(ws: SsWin[], id: SsWinId): SsWin[] {
  const top = Math.max(0, ...ws.map((w) => w.z));
  if (ws.some((w) => w.id === id)) return ws.map((w) => (w.id === id ? { ...w, minimized: false, z: top + 1 } : w));
  const n = ws.length;
  const x = typeof window === "undefined" ? 80 : Math.max(16, window.innerWidth - Math.min(720, window.innerWidth - 32) - 24 - n * 32);
  const y = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerHeight - 600, 72 + n * 28));
  return [...ws, { id, minimized: false, x, y, z: top + 1 }];
}
