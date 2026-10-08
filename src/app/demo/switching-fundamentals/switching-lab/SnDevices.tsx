"use client";

import { clsx } from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CliVendor } from "@/lib/cli/types";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { ConsoleTerminal, EMPTY_SESSION, type ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import { BCAST, SN_HOSTS, SN_IP, SN_MAC, SN_PORTS, isSw, isUplink, snCloneCfg, snFrameName, snHostAt, snMacName, snPeer, snPortRole, snPortStatus, snShortMac, snTable, type SnAction, type SnCap, type SnDev, type SnHost, type SnPort, type SnSnap, type SnState, type SnSw, type SnSwCfg } from "@/lib/sim-engine/scenarios/switchNet";
import { snJunosConfig, snPortName, snSwitchSets, type SnCliApi, type SnIosMode } from "./snCli";

/**
 * Switching Lab devices, Packet Tracer style (drag, minimize to a tray, resize; full screen on phones).
 *   SW1 / SW2: its ports (state, what is at the other end, counters; enable / disable), ITS OWN MAC table (with how
 *              long each entry has left), a Cisco/Junos console, a capture on any port, its log (links, MAC moves).
 *   Hosts:     the NIC (MAC, which switch port the cable is in — move it, unplug it), send traffic, a capture of what
 *              reached the NIC (kept or discarded).
 * Every number is read from the lab state; every change goes through the model.
 */

export interface SnDeskCtx {
  view: SnState;
  /** Tables/counters at the moment the topology is showing (during playback), else the current ones. */
  snap?: SnSnap;
  act: (a: SnAction) => SnState;
  vendor: CliVendor;
  setVendor: (v: CliVendor) => void;
  ios: Record<SnSw, SnIosMode>;
  setIos: (sw: SnSw, m: SnIosMode) => void;
  junosEdit: Record<SnSw, boolean>;
  setJunosEdit: (sw: SnSw, b: boolean) => void;
  cand: Record<SnSw, SnSwCfg>;
  setCand: (sw: SnSw, c: SnSwCfg) => void;
  consoles: Record<string, ConsoleSession>;
  setConsoles: (u: (m: Record<string, ConsoleSession>) => Record<string, ConsoleSession>) => void;
  notes: boolean;
  setNotes: (b: boolean) => void;
  question?: CliQuestion;
  setQuestion: (q: CliQuestion | undefined) => void;
}
export interface SnWin {
  id: SnDev;
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
const STATUS_TONE = { connected: "text-pv-success", notconnect: "text-pv-text-faint", disabled: "text-pv-danger" } as const;

// ---------------------------------------------------------------------------------------------------------------
// Captures
// ---------------------------------------------------------------------------------------------------------------
export const capPoints = (s: SnState): string[] => [...(["SW1", "SW2"] as SnSw[]).flatMap((sw) => SN_PORTS.filter((p) => snPeer(s.cfg, sw, p)).map((p) => `${sw} ${p}`)), ...SN_HOSTS.filter((h) => s.cfg.hosts[h].at)];
export function CaptureView({ s, points, initial, vendor }: { s: SnState; points: string[]; initial?: string; vendor: CliVendor }) {
  const [point, setPoint] = useState<string>(initial ?? points[0]);
  const [onlyLast, setOnlyLast] = useState(true);
  const [pick, setPick] = useState<SnCap | undefined>(undefined);
  const last = s.last;
  const rows = s.captures.filter((c) => c.point === point && (!onlyLast || !last || c.run === last.id)).slice(-120);
  const label = (p: string) => (p.includes(" ") ? `${p.split(" ")[0]} ${snPortName(vendor, p.split(" ")[1])}` : p);
  return (
    <div className="space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-pv-text-muted">
        {points.length > 1 && (
          <select value={point} onChange={(e) => (setPoint(e.target.value), setPick(undefined))} className="rounded-md border border-pv-border bg-pv-bg px-2 py-0.5 text-[12px] text-pv-text" aria-label="Capture point">
            {points.map((p) => (
              <option key={p} value={p}>
                {label(p)}
                {p.includes(" ") ? ` — ${snPortRole(s.cfg, p.split(" ")[0] as SnSw, p.split(" ")[1])}` : " NIC"}
              </option>
            ))}
          </select>
        )}
        <label className="ml-auto flex items-center gap-1">
          <input type="checkbox" checked={onlyLast} onChange={(e) => setOnlyLast(e.target.checked)} /> last run only
        </label>
      </div>
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-pv-text-faint">Nothing crossed {label(point)}{onlyLast ? " during the last run" : ""}. Silence is evidence too: no frame used this {point.includes(" ") ? "port" : "NIC"}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-[12px]">
            <thead className="text-[11px] text-pv-text-faint">
              <tr>
                <th className="px-1.5 py-1">#</th>
                <th className="px-1.5 py-1">hop</th>
                <th className="px-1.5 py-1">dir</th>
                <th className="px-1.5 py-1">source MAC → destination MAC</th>
                <th className="px-1.5 py-1">what</th>
                <th className="px-1.5 py-1">copies</th>
              </tr>
            </thead>
            <tbody className="pv-mono">
              {rows.map((c) => (
                <tr key={c.n} onClick={() => setPick(c)} className={clsx("cursor-pointer border-t border-pv-border/50 hover:bg-white/[0.03]", pick?.n === c.n && "bg-pv-cyan/10", c.count > 1 && "text-pv-warning")}>
                  <td className="px-1.5 py-0.5">{c.n}</td>
                  <td className="px-1.5 py-0.5">{c.wave + 1}</td>
                  <td className="px-1.5 py-0.5">{c.dir}</td>
                  <td className="px-1.5 py-0.5">
                    {snShortMac(c.frame.src)} ({snMacName(s.cfg, c.frame.src).replace("HOST-", "")}) → {c.frame.dst === BCAST ? "FF:FF:FF:FF:FF:FF" : `${snShortMac(c.frame.dst)} (${snMacName(s.cfg, c.frame.dst).replace("HOST-", "")})`}
                  </td>
                  <td className="px-1.5 py-0.5 font-sans">{snFrameName(c.frame)}</td>
                  <td className="px-1.5 py-0.5">{c.count > 1 ? `×${c.count.toLocaleString("en-US")}` : "1"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pick && (
        <div className="rounded-xl border border-pv-border bg-pv-bg/60 p-2.5 text-[12.5px]">
          <p className="font-semibold text-pv-text">
            #{pick.n} on {label(pick.point)} ({pick.dir === "in" ? "received" : "sent"}) · hop {pick.wave + 1} of run #{pick.run}
          </p>
          <div className="mt-1 grid gap-x-4 sm:grid-cols-2">
            <Kv k="Destination MAC" v={pick.frame.dst} />
            <Kv k="Source MAC" v={pick.frame.src} />
            <Kv k="EtherType" v={pick.frame.kind.startsWith("arp") ? "0x0806 (ARP)" : "0x0800 (IPv4)"} />
            <Kv k="Carries" v={snFrameName(pick.frame)} />
            <Kv k="Length" v={`${pick.frame.bytes} bytes`} />
            <Kv k="Hop count / TTL in the Ethernet header" v="none — Ethernet has no such field" tone="warn" />
          </div>
          {pick.count > 1 && <p className="mt-1.5 text-[12px] text-pv-warning">{pick.count.toLocaleString("en-US")} identical copies crossed this point in the same hop. A switch never changes a frame, so copies of one frame are indistinguishable.</p>}
        </div>
      )}
    </div>
  );
}

/** One switch's own table, with what each entry means from this switch's position and how long it has left. */
export function MacTable({ s, sw, snap, vendor, onClear }: { s: SnState; sw: SnSw; snap?: SnSnap; vendor: CliVendor; onClear?: () => void }) {
  const rows = snTable(s.cfg, (snap ?? s).fdb, sw);
  const aging = s.cfg.sw[sw].aging;
  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-pv-text-faint">Empty: {sw} has not received a frame since its table was last cleared. It knows nothing — frames to anyone are flooded.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] text-left text-[12px]">
            <thead className="text-[11px] text-pv-text-faint">
              <tr>
                <th className="px-1.5 py-1">MAC</th>
                <th className="px-1.5 py-1">belongs to</th>
                <th className="px-1.5 py-1">port</th>
                <th className="px-1.5 py-1">that port leads to</th>
                <th className="px-1.5 py-1">type</th>
                <th className="px-1.5 py-1">expires in</th>
              </tr>
            </thead>
            <tbody className="pv-mono">
              {rows.map((e) => (
                <tr key={e.mac} className="border-t border-pv-border/50">
                  <td className="px-1.5 py-0.5">{e.mac}</td>
                  <td className="px-1.5 py-0.5 font-semibold text-pv-text">{snMacName(s.cfg, e.mac)}</td>
                  <td className={clsx("px-1.5 py-0.5", isUplink(e.port) ? "text-pv-violet" : "text-pv-text")}>{snPortName(vendor, e.port)}</td>
                  <td className="px-1.5 py-0.5 font-sans text-pv-text-muted">{snPortRole(s.cfg, sw, e.port)}</td>
                  <td className="px-1.5 py-0.5">{e.type === "static" ? <span className="text-pv-warning">static</span> : "dynamic"}</td>
                  <td className="px-1.5 py-0.5">{e.type === "static" ? "never" : `${Math.max(0, aging - (s.clock - e.seen))} s`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11.5px] text-pv-text-muted">
        Learned from SOURCE MACs only. An entry is refreshed each time that MAC sends; after {aging} s of silence it is removed and frames to it are flooded again. {sw === "SW1" ? "SW2" : "SW1"} has its own, different table.
      </p>
      {onClear && (
        <button type="button" className={btn} onClick={onClear}>
          Clear {sw}&apos;s learned entries
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Device windows
// ---------------------------------------------------------------------------------------------------------------
function cliApi(c: SnDeskCtx, key: string): SnCliApi {
  return { view: c.view, act: c.act, ios: c.ios, setIos: c.setIos, junosEdit: c.junosEdit, setJunosEdit: c.setJunosEdit, cand: c.cand, setCand: c.setCand, ask: c.setQuestion, history: c.consoles[key]?.history ?? [] };
}
export function SwitchConsole({ c, sw, className }: { c: SnDeskCtx; sw: SnSw; className?: string }) {
  const os = c.vendor === "cisco" ? "ios" : "junos";
  const key = `${sw}:${os}`;
  const api = cliApi(c, key);
  return (
    <ConsoleTerminal
      key={key}
      sets={snSwitchSets(api, sw)}
      vendor={c.vendor}
      setVendor={c.setVendor}
      os={os}
      host={sw}
      session={c.consoles[key] ?? EMPTY_SESSION}
      setSession={(u) => c.setConsoles((m) => ({ ...m, [key]: u(m[key] ?? EMPTY_SESSION) }))}
      notes={c.notes}
      setNotes={c.setNotes}
      question={c.question?.node === sw ? c.question : undefined}
      pipeCtx={{ config: snJunosConfig(api, sw), rollbacks: 1 }}
      className={className ?? "h-[min(440px,58vh)]"}
    />
  );
}
function SwitchUI({ c, sw }: { c: SnDeskCtx; sw: SnSw }) {
  const [tab, setTab] = useState<"ports" | "mac" | "term" | "cap" | "log">("ports");
  const s = c.view;
  const cfg = s.cfg;
  const snap = c.snap;
  const ctr = (snap ?? s).counters;
  const toggle = (p: SnPort) => {
    const n = snCloneCfg(cfg);
    const shut = n.sw[sw].shut.includes(p);
    n.sw[sw].shut = shut ? n.sw[sw].shut.filter((x) => x !== p) : [...n.sw[sw].shut, p];
    c.act({ type: "cfg", cfg: n, text: `${sw}: ${shut ? "enabled" : "disabled"} ${p}` });
  };
  const cable = (p: SnPort) => {
    const n = snCloneCfg(cfg);
    n.cables[p as "ge-0/0/22"] = !n.cables[p as "ge-0/0/22"];
    c.act({ type: "cfg", cfg: n, text: `${n.cables[p as "ge-0/0/22"] ? "Plugged" : "Unplugged"} a cable between SW1 ${p} and SW2 ${p}` });
  };
  const moves = s.moves.filter((m) => m.sw === sw);
  return (
    <>
      <Tabs
        tabs={[
          ["ports", "Ports"],
          ["mac", "MAC table"],
          ["term", "Console"],
          ["cap", "Capture"],
          ["log", "Log"],
        ]}
        cur={tab}
        set={setTab}
      />
      {tab === "ports" && (
        <div className="space-y-2 p-3">
          <p className="text-[12.5px] text-pv-text-muted">
            {sw} forwards frames between its ports using only its own table. Uplinks lead to {sw === "SW1" ? "SW2" : "SW1"}; an access port leads to one host.
            {snap ? " Counters: as of the moment the topology is showing." : ""}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[12px]">
              <thead className="text-[11px] text-pv-text-faint">
                <tr>
                  <th className="px-1.5 py-1">port</th>
                  <th className="px-1.5 py-1">status</th>
                  <th className="px-1.5 py-1">leads to</th>
                  <th className="px-1.5 py-1">frames in / out</th>
                  <th className="px-1.5 py-1">broadcasts in / out</th>
                  <th className="px-1.5 py-1" />
                </tr>
              </thead>
              <tbody>
                {SN_PORTS.map((p) => {
                  const st = snPortStatus(cfg, sw, p);
                  const k = ctr[`${sw} ${p}`];
                  return (
                    <tr key={p} className="border-t border-pv-border/50">
                      <td className="pv-mono whitespace-nowrap px-1.5 py-1 text-pv-text">{snPortName(c.vendor, p)}</td>
                      <td className={clsx("pv-mono px-1.5 py-1", STATUS_TONE[st])}>{st}</td>
                      <td className="px-1.5 py-1 text-pv-text-muted">{snPortRole(cfg, sw, p)}</td>
                      <td className="pv-mono px-1.5 py-1">
                        {k.inF.toLocaleString("en-US")} / {k.outF.toLocaleString("en-US")}
                      </td>
                      <td className="pv-mono px-1.5 py-1">
                        {k.inB.toLocaleString("en-US")} / {k.outB.toLocaleString("en-US")}
                      </td>
                      <td className="px-1.5 py-1 text-right">
                        {(snPeer(cfg, sw, p) || st === "disabled") && (
                          <button type="button" className={btn} onClick={() => toggle(p)}>
                            {st === "disabled" ? "Enable" : "Disable"}
                          </button>
                        )}
                        {p === "ge-0/0/22" && (
                          <button type="button" className={clsx(btn, "ml-1")} onClick={() => cable(p)}>
                            {cfg.cables["ge-0/0/22"] ? "Unplug cable" : "Plug a 3rd cable"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button type="button" className={btn} onClick={() => c.act({ type: "clear-counters", sw })}>
            Clear counters
          </button>
        </div>
      )}
      {tab === "mac" && (
        <div className="space-y-2 p-3">
          <MacTable s={s} sw={sw} snap={snap} vendor={c.vendor} onClear={() => c.act({ type: "clear", sw })} />
        </div>
      )}
      {tab === "term" && <SwitchConsole c={c} sw={sw} />}
      {tab === "cap" && <CaptureView s={s} points={SN_PORTS.filter((p) => snPeer(cfg, sw, p)).map((p) => `${sw} ${p}`)} vendor={c.vendor} />}
      {tab === "log" && (
        <div className="space-y-1 p-3 text-[12.5px]">
          {moves.length === 0 ? (
            <p className="text-pv-text-faint">No MAC has moved between {sw}&apos;s ports.</p>
          ) : (
            moves.slice(-30).map((m, i) => (
              <p key={i} className={clsx("pv-mono text-[12px]", m.flap ? "text-pv-danger" : "text-pv-warning")}>
                t={m.clock}s · {snMacName(cfg, m.mac)} moved {snPortName(c.vendor, m.from)} → {snPortName(c.vendor, m.to)}
                {m.flap ? " · back and forth (flapping)" : ""}
              </p>
            ))
          )}
          <p className="pt-1 text-[11.5px] text-pv-text-muted">A MAC appearing on a new port moves its entry. Once: a host moved. Back and forth: frames from that MAC keep arriving from two directions — a loop, or two devices with one MAC.</p>
        </div>
      )}
    </>
  );
}
const SPARE: { sw: SnSw; port: SnPort }[] = [
  { sw: "SW1", port: "ge-0/0/1" },
  { sw: "SW1", port: "ge-0/0/2" },
  { sw: "SW1", port: "ge-0/0/3" },
  { sw: "SW2", port: "ge-0/0/1" },
  { sw: "SW2", port: "ge-0/0/2" },
  { sw: "SW2", port: "ge-0/0/3" },
];
function HostUI({ c, h }: { c: SnDeskCtx; h: SnHost }) {
  const [tab, setTab] = useState<"nic" | "send" | "cap">("nic");
  const s = c.view;
  const nic = s.cfg.hosts[h];
  const at = nic.at;
  const others = SN_HOSTS.filter((x) => x !== h && s.cfg.hosts[x].at);
  const setMac = (mac: string) => {
    const n = snCloneCfg(s.cfg);
    n.hosts[h].mac = mac;
    c.act({ type: "cfg", cfg: n, text: `${h}: NIC MAC set to ${mac}` });
  };
  return (
    <>
      <Tabs
        tabs={[
          ["nic", "Network card"],
          ["send", "Send"],
          ["cap", "Capture"],
        ]}
        cur={tab}
        set={setTab}
      />
      {tab === "nic" && (
        <div className="space-y-2 p-3">
          <Kv k="MAC address" v={nic.mac} tone={h !== "HOST-A" && nic.mac === SN_MAC["HOST-A"] ? "bad" : undefined} />
          <Kv k="IPv4 address" v={SN_IP[h]} />
          <Kv k="Cable plugged into" v={at ? `${at.sw} ${snPortName(c.vendor, at.port)}` : "nothing (unplugged)"} tone={at ? undefined : "warn"} />
          <Kv k="Link" v={at ? snPortStatus(s.cfg, at.sw, at.port) : "down"} />
          <p className="text-[12.5px] text-pv-text-muted">A host knows nothing about switches: it puts its own MAC as the source of every frame and keeps frames addressed to its MAC or to broadcast. Moving the cable doesn&apos;t tell any switch — only the next frame this host SENDS does.</p>
          <p className="pt-1 text-[11px] font-bold uppercase tracking-wide text-pv-text-faint">Move the cable</p>
          <div className="flex flex-wrap gap-1">
            {SPARE.filter((x) => !snHostAt(s.cfg, x.sw, x.port) || snHostAt(s.cfg, x.sw, x.port) === h).map((x) => {
              const here = at?.sw === x.sw && at.port === x.port;
              return (
                <button key={`${x.sw}${x.port}`} type="button" disabled={here} className={btn} onClick={() => c.act({ type: "move", host: h, to: x })}>
                  {here ? "✓ " : ""}
                  {x.sw} {snPortName(c.vendor, x.port)}
                </button>
              );
            })}
            {at && (
              <button type="button" className={btn} onClick={() => c.act({ type: "move", host: h })}>
                Unplug
              </button>
            )}
          </div>
          {h === "HOST-E" && (
            <div className="space-y-1 rounded-lg border border-pv-border p-2">
              <p className="text-[12px] text-pv-text-muted">HOST-E is a virtual machine: its MAC is a setting of its virtual NIC (a clone keeps the original&apos;s MAC unless someone regenerates it).</p>
              <div className="flex flex-wrap gap-1">
                <button type="button" className={btn} disabled={nic.mac === SN_MAC["HOST-E"]} onClick={() => setMac(SN_MAC["HOST-E"])}>
                  Regenerate MAC → {SN_MAC["HOST-E"]}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {tab === "send" && (
        <div className="space-y-2 p-3">
          <p className="text-[12.5px] text-pv-text-muted">Frames this host sends. A ping is a unicast frame to the other host&apos;s MAC (it answers); an ARP request is a broadcast (the host whose IP is asked answers).</p>
          <div className="flex flex-wrap gap-1">
            {others.map((o) => (
              <button key={o} type="button" className={btn} disabled={!at} onClick={() => c.act({ type: "traffic", sends: [{ from: h, to: o, reply: true }] })}>
                Ping {o}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {others.map((o) => (
              <button key={o} type="button" className={btn} disabled={!at} onClick={() => c.act({ type: "traffic", sends: [{ from: h, to: "broadcast", arpFor: o }] })}>
                ARP: who has {SN_IP[o]}?
              </button>
            ))}
          </div>
        </div>
      )}
      {tab === "cap" && <CaptureView s={s} points={[h]} vendor={c.vendor} />}
    </>
  );
}

const SUB = (c: SnDeskCtx, id: SnDev) => (isSw(id) ? `Managed switch · ${c.vendor === "cisco" ? "Cisco IOS" : "Junos"} view` : `${c.view.cfg.hosts[id].mac} · ${SN_IP[id]}`);
function Win({ w, c, narrow, focused, onFocus, onMove, onMin, onClose }: { w: SnWin; c: SnDeskCtx; narrow: boolean; focused: boolean; onFocus: () => void; onMove: (x: number, y: number) => void; onMin: () => void; onClose: () => void }) {
  const drag = useRef<{ dx: number; dy: number } | undefined>(undefined);
  const tone = isSw(w.id) ? "#22d3ee" : "#34d399";
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
          {isSw(w.id) ? "⇄" : "💻"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-bold text-pv-text">{w.id}</p>
          <p className="truncate text-[11px] text-pv-text-faint">{SUB(c, w.id)}</p>
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
      <div className="min-h-0 flex-1 overflow-y-auto">{isSw(w.id) ? <SwitchUI c={c} sw={w.id} /> : <HostUI c={c} h={w.id} />}</div>
    </section>
  );
}

export function SnDesk({ windows, setWindows, focus, setFocus, ctx }: { windows: SnWin[]; setWindows: (u: (w: SnWin[]) => SnWin[]) => void; focus?: SnDev; setFocus: (n: SnDev | undefined) => void; ctx: SnDeskCtx }) {
  const narrow = useNarrow();
  if (typeof document === "undefined" || !windows.length) return null;
  const top = Math.max(0, ...windows.map((w) => w.z));
  const raise = (id: SnDev) => {
    setFocus(id);
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, z: top + 1, minimized: false } : w)));
  };
  const minimize = (id: SnDev) => (setWindows((ws) => ws.map((v) => (v.id === id ? { ...v, minimized: true } : v))), setFocus(undefined));
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
export function openSnWindow(ws: SnWin[], id: SnDev): SnWin[] {
  const top = Math.max(0, ...ws.map((w) => w.z));
  if (ws.some((w) => w.id === id)) return ws.map((w) => (w.id === id ? { ...w, minimized: false, z: top + 1 } : w));
  const n = ws.length;
  const x = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerWidth - 820, 40 + n * 36));
  const y = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerHeight - 640, 90 + n * 30));
  return [...ws, { id, minimized: false, x, y, z: top + 1 }];
}
