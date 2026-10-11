"use client";

import { clsx } from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CliVendor } from "@/lib/cli/types";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { ConsoleTerminal, EMPTY_SESSION, type ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import { BCAST, RTR_PORT, TRUNK, VL_HOSTS, VL_PORTS, isSw, netOf, vlClone, vlFrameName, vlHostAt, vlInactive, vlMacName, vlPeer, vlPortRole, vlPortStatus, vlPortUp, vlPortVlans, vlShortMac, vlTable, vlanName, type VlAction, type VlCap, type VlDev, type VlHost, type VlPort, type VlPortCfg, type VlSnap, type VlState, type VlSw } from "@/lib/sim-engine/scenarios/vlanNet";
import { vlHostSet, vlJunosConfig, vlR1Sets, vlSwitchSets, vlanRange, type VlCand, type VlCliApi, type VlIosMode, type VlR1Mode } from "./vlCli";
import { r1IfName, vlPortName } from "./vlNames";
import { vlanColor } from "./vlMoments";

/**
 * VLAN Lab devices (drag, minimize to a tray; full screen on phones).
 *   SW1 / SW2  Ports (mode, access VLAN, allowed list, native VLAN — change any of them; link, tagged counters, drops)
 *              · VLANs (the VLAN database) · MAC table by VLAN · Cisco/Junos console · capture on any port (with the
 *              802.1Q tag column) · log
 *   R1         subinterfaces (unit, the VID it accepts, its address) · ARP and routes · console · capture on its port
 *   Hosts      the NIC (no VLAN anywhere: IP, gateway, which port the cable is in) · send · capture · Linux shell
 * Every value is read from the lab state; every change goes through the model.
 */

export type VlDeskDev = VlDev;
export interface VlDeskCtx {
  view: VlState;
  snap?: VlSnap;
  act: (a: VlAction) => VlState;
  vendor: CliVendor;
  setVendor: (v: CliVendor) => void;
  ios: Record<VlSw | "R1", VlIosMode | VlR1Mode>;
  setIos: (d: VlSw | "R1", m: VlIosMode | VlR1Mode) => void;
  junosEdit: Record<VlSw | "R1", boolean>;
  setJunosEdit: (d: VlSw | "R1", b: boolean) => void;
  cand: VlCand;
  setCand: (c: VlCand) => void;
  consoles: Record<string, ConsoleSession>;
  setConsoles: (u: (m: Record<string, ConsoleSession>) => Record<string, ConsoleSession>) => void;
  notes: boolean;
  setNotes: (b: boolean) => void;
  question?: CliQuestion;
  setQuestion: (q: CliQuestion | undefined) => void;
}
export interface VlWin {
  id: VlDev;
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
const STATUS_TONE = { connected: "text-pv-success", notconnect: "text-pv-text-faint", disabled: "text-pv-danger" } as const;
export const VTag = ({ v, native }: { v?: number; native?: boolean }) =>
  v === undefined ? (
    <span className="rounded border border-dashed border-pv-border px-1 text-[11px] text-pv-text-faint">untagged{native ? " (native)" : ""}</span>
  ) : (
    <span className="rounded px-1 text-[11px] font-bold text-[#03131a]" style={{ background: vanilla(v) }}>
      VID {v}
    </span>
  );
const vanilla = (v: number) => vlanColor(v);

// ---------------------------------------------------------------------------------------------------------------
// Captures
// ---------------------------------------------------------------------------------------------------------------
export const capPoints = (s: VlState): string[] => [...(["SW1", "SW2"] as VlSw[]).flatMap((sw) => VL_PORTS.filter((p) => vlPeer(s.cfg, sw, p)).map((p) => `${sw} ${p}`)), "R1 ge-0/0/0", ...VL_HOSTS.filter((h) => s.cfg.hosts[h].at)];
export const capLabel = (vendor: CliVendor, p: string) => (p === "R1 ge-0/0/0" ? `R1 ${r1IfName(vendor)}` : p.includes(" ") ? `${p.split(" ")[0]} ${vlPortName(vendor, p.split(" ")[1])}` : p);
export function CaptureView({ s, points, initial, vendor }: { s: VlState; points: string[]; initial?: string; vendor: CliVendor }) {
  const [point, setPoint] = useState<string>(initial && points.includes(initial) ? initial : points[0]);
  const [onlyLast, setOnlyLast] = useState(true);
  const [pick, setPick] = useState<VlCap | undefined>(undefined);
  const last = s.last;
  const rows = s.captures.filter((c) => c.point === point && (!onlyLast || !last || c.run === last.id)).slice(-120);
  const role = (p: string) => (p === "R1 ge-0/0/0" ? "trunk to SW2" : p.includes(" ") ? vlPortRole(s.cfg, p.split(" ")[0] as VlSw, p.split(" ")[1]) : "NIC");
  return (
    <div className="space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-pv-text-muted">
        {points.length > 1 && (
          <select value={point} onChange={(e) => (setPoint(e.target.value), setPick(undefined))} className="rounded-md border border-pv-border bg-pv-bg px-2 py-0.5 text-[12px] text-pv-text" aria-label="Capture point">
            {points.map((p) => (
              <option key={p} value={p}>
                {capLabel(vendor, p)} — {role(p)}
              </option>
            ))}
          </select>
        )}
        <label className="ml-auto flex items-center gap-1">
          <input type="checkbox" checked={onlyLast} onChange={(e) => setOnlyLast(e.target.checked)} /> last run only
        </label>
      </div>
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-pv-text-faint">Nothing crossed {capLabel(vendor, point)}{onlyLast ? " during the last run" : ""}. Silence is evidence too: no frame of any VLAN used this {point.includes(" ") ? "port" : "NIC"}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[12px]">
            <thead className="text-[11px] text-pv-text-faint">
              <tr>
                <th className="px-1.5 py-1">#</th>
                <th className="px-1.5 py-1">hop</th>
                <th className="px-1.5 py-1">dir</th>
                <th className="px-1.5 py-1">802.1Q tag</th>
                <th className="px-1.5 py-1">src → dst MAC</th>
                <th className="px-1.5 py-1">what</th>
              </tr>
            </thead>
            <tbody className="pv-mono">
              {rows.map((c) => (
                <tr key={c.n} onClick={() => setPick(c)} className={clsx("cursor-pointer border-t border-pv-border/50 hover:bg-white/[0.03]", pick?.n === c.n && "bg-pv-cyan/10")}>
                  <td className="px-1.5 py-0.5">{c.n}</td>
                  <td className="px-1.5 py-0.5">{c.wave + 1}</td>
                  <td className="px-1.5 py-0.5">{c.dir}</td>
                  <td className="px-1.5 py-0.5">
                    <VTag v={c.vid} />
                  </td>
                  <td className="px-1.5 py-0.5">
                    {vlShortMac(c.frame.src)} ({vlMacName(s.cfg, c.frame.src).replace("HOST-", "")}) → {c.frame.dst === BCAST ? "broadcast" : `${vlShortMac(c.frame.dst)} (${vlMacName(s.cfg, c.frame.dst).replace("HOST-", "")})`}
                  </td>
                  <td className="px-1.5 py-0.5 font-sans">{vlFrameName(c.frame)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pick && (
        <div className="rounded-xl border border-pv-border bg-pv-bg/60 p-2.5 text-[12.5px]">
          <p className="font-semibold text-pv-text">
            #{pick.n} on {capLabel(vendor, pick.point)} ({pick.dir === "in" ? "received" : "sent"}) · hop {pick.wave + 1} of run #{pick.run}
          </p>
          <div className="mt-1 grid gap-x-4 sm:grid-cols-2">
            <Kv k="Destination MAC" v={pick.frame.dst} />
            <Kv k="Source MAC" v={pick.frame.src} />
            {pick.vid !== undefined ? (
              <>
                <Kv k="TPID (802.1Q tag follows)" v="0x8100" tone="ok" />
                <Kv k="PCP · DEI · VID" v={`0 · 0 · ${pick.vid}`} tone="ok" />
              </>
            ) : (
              <Kv k="802.1Q tag" v="none (untagged)" />
            )}
            <Kv k="EtherType" v={pick.frame.kind.startsWith("arp") ? "0x0806 (ARP)" : "0x0800 (IPv4)"} />
            <Kv k="Carries" v={vlFrameName(pick.frame)} />
            {!pick.frame.kind.startsWith("arp") && <Kv k="IPv4 TTL" v={pick.frame.ttl} tone={pick.frame.ttl < 64 ? "warn" : undefined} />}
            <Kv k="Length" v={`${pick.frame.bytes + (pick.vid !== undefined ? 4 : 0)} bytes${pick.vid !== undefined ? " (tag +4)" : ""}`} />
          </div>
          <p className="mt-1.5 text-[11.5px] text-pv-text-muted">The tag is 4 bytes inserted after the source MAC. It exists only on this link: the next access port removes it again.</p>
        </div>
      )}
    </div>
  );
}

/** One switch's table, grouped by VLAN. */
export function VlanMacTable({ s, sw, snap, vendor, onClear }: { s: VlState; sw: VlSw; snap?: VlSnap; vendor: CliVendor; onClear?: () => void }) {
  const rows = vlTable((snap ?? s).fdb, sw);
  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-pv-text-faint">Empty: {sw} has learned nothing in any VLAN.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[440px] text-left text-[12px]">
            <thead className="text-[11px] text-pv-text-faint">
              <tr>
                <th className="px-1.5 py-1">VLAN</th>
                <th className="px-1.5 py-1">MAC</th>
                <th className="px-1.5 py-1">belongs to</th>
                <th className="px-1.5 py-1">port</th>
                <th className="px-1.5 py-1">that port leads to</th>
                <th className="px-1.5 py-1">expires in</th>
              </tr>
            </thead>
            <tbody className="pv-mono">
              {rows.map((e) => (
                <tr key={`${e.vlan}${e.mac}`} className="border-t border-pv-border/50">
                  <td className="px-1.5 py-0.5 font-bold" style={{ color: vlanColor(e.vlan) }}>
                    {e.vlan}
                  </td>
                  <td className="px-1.5 py-0.5">{e.mac}</td>
                  <td className="px-1.5 py-0.5 font-semibold text-pv-text">{vlMacName(s.cfg, e.mac)}</td>
                  <td className="px-1.5 py-0.5">{vlPortName(vendor, e.port)}</td>
                  <td className="px-1.5 py-0.5 font-sans text-pv-text-muted">{vlPortRole(s.cfg, sw, e.port)}</td>
                  <td className="px-1.5 py-0.5">{Math.max(0, 300 - (s.clock - e.seen))} s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11.5px] text-pv-text-muted">Each entry is (VLAN, MAC) → port. A frame in VLAN 10 is looked up among VLAN 10 entries only — the same MAC in another VLAN would be a different entry.</p>
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
function cliApi(c: VlDeskCtx, key: string): VlCliApi {
  return { view: c.view, act: c.act, ios: c.ios, setIos: c.setIos, junosEdit: c.junosEdit, setJunosEdit: c.setJunosEdit, cand: c.cand, setCand: c.setCand, ask: c.setQuestion, history: c.consoles[key]?.history ?? [] };
}
export function DevConsole({ c, dev, className }: { c: VlDeskCtx; dev: VlDev; className?: string }) {
  const host = !isSw(dev) && dev !== "R1";
  const os = host ? "linux" : c.vendor === "cisco" ? "ios" : "junos";
  const key = `${dev}:${os}`;
  const api = cliApi(c, key);
  const sets = host ? { cisco: vlHostSet(api, dev as VlHost), juniper: vlHostSet(api, dev as VlHost) } : dev === "R1" ? vlR1Sets(api) : vlSwitchSets(api, dev as VlSw);
  return (
    <ConsoleTerminal
      key={key}
      sets={sets}
      vendor={c.vendor}
      setVendor={host ? undefined : c.setVendor}
      os={os}
      host={dev}
      session={c.consoles[key] ?? EMPTY_SESSION}
      setSession={(u) => c.setConsoles((m) => ({ ...m, [key]: u(m[key] ?? EMPTY_SESSION) }))}
      notes={c.notes}
      setNotes={c.setNotes}
      question={c.question?.node === dev ? c.question : undefined}
      pipeCtx={host ? undefined : { config: vlJunosConfig(api, dev as VlSw | "R1"), rollbacks: 1 }}
      className={className ?? "h-[min(440px,58vh)]"}
    />
  );
}

function SwitchUI({ c, sw }: { c: VlDeskCtx; sw: VlSw }) {
  const [tab, setTab] = useState<"ports" | "vlans" | "mac" | "term" | "cap" | "log">("ports");
  const [newVlan, setNewVlan] = useState("30");
  const s = c.view;
  const cfg = s.cfg;
  const sc = cfg.sw[sw];
  const ctr = (c.snap ?? s).counters;
  const setPort = (p: VlPort, patch: Partial<VlPortCfg>, text: string) => {
    const n = vlClone(cfg);
    n.sw[sw].ports[p] = { ...n.sw[sw].ports[p], ...patch };
    if (patch.mode === "trunk" && !n.sw[sw].ports[p].allowed.length) n.sw[sw].ports[p].allowed = [...n.sw[sw].vlans];
    c.act({ type: "cfg", cfg: n, text: `${sw} ${p}: ${text}` });
  };
  const toggleAllowed = (p: VlPort, v: number) => {
    const al = sc.ports[p].allowed;
    setPort(p, { allowed: al.includes(v) ? al.filter((x) => x !== v) : [...al, v].sort((a, b) => a - b) }, `${al.includes(v) ? "removed" : "allowed"} VLAN ${v} on the trunk`);
  };
  const logs = s.syslog.filter((l) => l.sw === sw);
  return (
    <>
      <Tabs
        tabs={[
          ["ports", "Ports"],
          ["vlans", "VLANs"],
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
            Each port&apos;s VLAN settings decide which broadcast domain its frames belong to. <b className="text-pv-text">Access</b>: one VLAN, untagged (a host). <b className="text-pv-text">Trunk</b>: the allowed VLANs, each tagged with its VID — except the native VLAN, sent untagged.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[12px]">
              <thead className="text-[11px] text-pv-text-faint">
                <tr>
                  <th className="px-1.5 py-1">port</th>
                  <th className="px-1.5 py-1">leads to</th>
                  <th className="px-1.5 py-1">status</th>
                  <th className="px-1.5 py-1">mode</th>
                  <th className="px-1.5 py-1">VLAN(s)</th>
                  <th className="px-1.5 py-1">in / out · tagged · drops</th>
                </tr>
              </thead>
              <tbody>
                {VL_PORTS.map((p) => {
                  const pc = sc.ports[p];
                  const st = vlPortStatus(cfg, sw, p);
                  const k = ctr[`${sw} ${p}`];
                  return (
                    <tr key={p} className="border-t border-pv-border/50 align-top">
                      <td className="pv-mono whitespace-nowrap px-1.5 py-1 text-pv-text">{vlPortName(c.vendor, p)}</td>
                      <td className="px-1.5 py-1 text-pv-text-muted">{vlPortRole(cfg, sw, p)}</td>
                      <td className={clsx("pv-mono px-1.5 py-1", STATUS_TONE[st])}>
                        {vlInactive(cfg, sw, p) && st === "connected" ? <span className="text-pv-warning">inactive</span> : st}
                        <button type="button" className={clsx(btn, "ml-1 px-1.5 text-[11px]")} onClick={() => setPort(p, { shut: !pc.shut }, pc.shut ? "enabled" : "disabled")}>
                          {pc.shut ? "Enable" : "Disable"}
                        </button>
                      </td>
                      <td className="px-1.5 py-1">
                        <select aria-label={`${sw} ${p} mode`} className={sel} value={pc.mode} onChange={(e) => setPort(p, { mode: e.target.value as VlPortCfg["mode"] }, `mode ${e.target.value}`)}>
                          <option value="access">access</option>
                          <option value="trunk">trunk</option>
                        </select>
                      </td>
                      <td className="px-1.5 py-1">
                        {pc.mode === "access" ? (
                          <select aria-label={`${sw} ${p} access VLAN`} className={sel} value={pc.access} onChange={(e) => setPort(p, { access: +e.target.value }, `access VLAN ${e.target.value}`)}>
                            {[...new Set([...sc.vlans, pc.access])].map((v) => (
                              <option key={v} value={v}>
                                {v} {sc.vlans.includes(v) ? vlanName(v, cfg, sw) : "(not defined)"}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="text-[11px] text-pv-text-faint">allowed</span>
                              {sc.vlans.map((v) => (
                                <button key={v} type="button" aria-pressed={pc.allowed.includes(v)} onClick={() => toggleAllowed(p, v)} className={clsx("pv-mono rounded border px-1 text-[11px] font-bold", pc.allowed.includes(v) ? "text-[#03131a]" : "border-pv-border text-pv-text-faint line-through")} style={pc.allowed.includes(v) ? { background: vlanColor(v), borderColor: vlanColor(v) } : undefined}>
                                  {v}
                                </button>
                              ))}
                            </div>
                            <label className="flex items-center gap-1 text-[11px] text-pv-text-faint">
                              native
                              <select aria-label={`${sw} ${p} native VLAN`} className={sel} value={pc.native} onChange={(e) => setPort(p, { native: +e.target.value }, `native VLAN ${e.target.value}`)}>
                                {[...new Set([...sc.vlans, pc.native])].map((v) => (
                                  <option key={v} value={v}>
                                    {v}
                                  </option>
                                ))}
                              </select>
                              <span className="pv-mono">carries {vlanRange(vlPortVlans(cfg, sw, p))}</span>
                            </label>
                          </div>
                        )}
                      </td>
                      <td className="pv-mono px-1.5 py-1 text-pv-text-muted">
                        {k.inF}/{k.outF} · {k.tagIn}/{k.tagOut} · <span className={k.drops ? "text-pv-danger" : undefined}>{k.drops}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11.5px] text-pv-text-faint">Tagged = frames that crossed with an 802.1Q tag (in/out). Drops = frames this port refused: a VLAN it doesn&apos;t carry, a VLAN that doesn&apos;t exist, or a tagged frame on an access port.{c.snap ? " Counters as of the hop on screen." : ""}</p>
          <button type="button" className={btn} onClick={() => c.act({ type: "clear-counters", sw })}>
            Clear counters
          </button>
        </div>
      )}
      {tab === "vlans" && (
        <div className="space-y-2 p-3">
          <p className="text-[12.5px] text-pv-text-muted">The VLAN database of {sw}. A VLAN must exist here before any port can carry it; each switch has its own — nothing copies it to {sw === "SW1" ? "SW2" : "SW1"}.</p>
          <table className="w-full text-left text-[12px]">
            <tbody>
              {sc.vlans.map((v) => {
                const acc = VL_PORTS.filter((p) => sc.ports[p].mode === "access" && sc.ports[p].access === v);
                const tr = VL_PORTS.filter((p) => sc.ports[p].mode === "trunk" && sc.ports[p].allowed.includes(v));
                return (
                  <tr key={v} className="border-t border-pv-border/50">
                    <td className="pv-mono px-1.5 py-1 font-bold" style={{ color: vlanColor(v) }}>
                      {v}
                    </td>
                    <td className="px-1.5 py-1 text-pv-text">{vlanName(v, cfg, sw)}</td>
                    <td className="pv-mono px-1.5 py-1 text-pv-text-muted">
                      access: {acc.map((p) => vlPortName(c.vendor, p)).join(", ") || "—"} · trunks: {tr.map((p) => vlPortName(c.vendor, p)).join(", ") || "—"}
                    </td>
                    <td className="px-1.5 py-1 text-right">
                      {v !== 1 && (
                        <button
                          type="button"
                          className={btn}
                          onClick={() => {
                            const n = vlClone(cfg);
                            n.sw[sw].vlans = n.sw[sw].vlans.filter((x) => x !== v);
                            c.act({ type: "cfg", cfg: n, text: `${sw}: deleted VLAN ${v}` });
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
            <input aria-label="New VLAN ID" value={newVlan} onChange={(e) => setNewVlan(e.target.value.replace(/\D/g, "").slice(0, 4))} className="pv-mono w-16 rounded-md border border-pv-border bg-pv-bg px-1.5 py-0.5 text-pv-text" />
            <button
              type="button"
              className={btn}
              disabled={!(+newVlan >= 2 && +newVlan <= 4094) || sc.vlans.includes(+newVlan)}
              onClick={() => {
                const v = +newVlan;
                const n = vlClone(cfg);
                n.sw[sw].vlans = [...n.sw[sw].vlans, v].sort((a, b) => a - b);
                n.sw[sw].names[v] = vlanName(v);
                c.act({ type: "cfg", cfg: n, text: `${sw}: created VLAN ${v}` });
              }}
            >
              Create VLAN
            </button>
          </div>
        </div>
      )}
      {tab === "mac" && (
        <div className="p-3">
          <VlanMacTable s={s} sw={sw} snap={c.snap} vendor={c.vendor} onClear={() => c.act({ type: "clear", sw })} />
        </div>
      )}
      {tab === "term" && <DevConsole c={c} dev={sw} />}
      {tab === "cap" && <CaptureView s={s} points={VL_PORTS.filter((p) => vlPeer(cfg, sw, p)).map((p) => `${sw} ${p}`)} initial={`${sw} ${TRUNK}`} vendor={c.vendor} />}
      {tab === "log" && (
        <div className="space-y-1 p-3 text-[12.5px]">
          {logs.length === 0 ? (
            <p className="text-pv-text-faint">No events.</p>
          ) : (
            logs.slice(-30).map((l, i) => (
              <p key={i} className={clsx("pv-mono text-[12px]", l.ev === "native" ? "text-pv-danger" : l.ev === "move" ? "text-pv-warning" : "text-pv-text-muted")}>
                t={l.clock}s ·{" "}
                {l.ev === "native"
                  ? `native VLAN mismatch on ${vlPortName(c.vendor, TRUNK)}: here ${l.native}, ${sw === "SW1" ? "SW2" : "SW1"} ${l.peerNative}${c.vendor === "cisco" ? " (CDP)" : " (Junos would not log this — shown from the lab)"}`
                  : l.ev === "move"
                    ? `${vlMacName(cfg, l.mac!)} moved in VLAN ${l.vlan}: ${vlPortName(c.vendor, l.from!)} → ${vlPortName(c.vendor, l.to!)}`
                    : `${vlPortName(c.vendor, l.port!)} ${l.ev === "admin-down" ? "administratively down" : l.ev}`}
              </p>
            ))
          )}
        </div>
      )}
    </>
  );
}

function RouterUI({ c }: { c: VlDeskCtx }) {
  const [tab, setTab] = useState<"subs" | "tables" | "term" | "cap">("subs");
  const s = c.view;
  const r = s.cfg.r1;
  const up = vlPortUp(s.cfg, "SW2", RTR_PORT) && !r.shut;
  const setVid = (unit: number, vid: number) => {
    const n = vlClone(s.cfg);
    n.r1.subs = n.r1.subs.map((x) => (x.unit === unit ? { ...x, vid } : x));
    c.act({ type: "cfg", cfg: n, text: `R1 .${unit}: VLAN ID ${vid}` });
  };
  const ctr = (c.snap ?? s).counters.R1;
  return (
    <>
      <Tabs
        tabs={[
          ["subs", "Subinterfaces"],
          ["tables", "ARP & routes"],
          ["term", "Console"],
          ["cap", "Capture"],
        ]}
        cur={tab}
        set={setTab}
      />
      {tab === "subs" && (
        <div className="space-y-2 p-3">
          <p className="text-[12.5px] text-pv-text-muted">
            One cable to SW2&apos;s trunk port, one <b className="text-pv-text">subinterface per VLAN</b>. Each accepts only frames tagged with its VID and tags what it sends with it — so each is that VLAN&apos;s default gateway. (Lab device: in this lesson R1 exists only to show how VLANs are joined. The Routing lessons cover the router itself.)
          </p>
          <Kv k={`Physical port ${r1IfName(c.vendor)}`} v={r.shut ? "administratively down" : up ? "up · 802.1Q trunk" : "down"} tone={up ? "ok" : "bad"} />
          <table className="w-full text-left text-[12px]">
            <thead className="text-[11px] text-pv-text-faint">
              <tr>
                <th className="px-1.5 py-1">subinterface</th>
                <th className="px-1.5 py-1">VLAN ID it accepts</th>
                <th className="px-1.5 py-1">address (the gateway)</th>
                <th className="px-1.5 py-1">state</th>
              </tr>
            </thead>
            <tbody>
              {r.subs.map((x) => (
                <tr key={x.unit} className="border-t border-pv-border/50">
                  <td className="pv-mono px-1.5 py-1 text-pv-text">{r1IfName(c.vendor, x.unit)}</td>
                  <td className="px-1.5 py-1">
                    <select aria-label={`R1 .${x.unit} VLAN ID`} className={sel} value={x.vid} onChange={(e) => setVid(x.unit, +e.target.value)}>
                      {[...new Set([10, 20, 30, x.vid])].map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="pv-mono px-1.5 py-1">
                    {x.ip}/{x.prefix} <span className="text-pv-text-faint">({netOf(x.ip, x.prefix)}/{x.prefix})</span>
                  </td>
                  <td className={clsx("pv-mono px-1.5 py-1", x.shut ? "text-pv-danger" : up ? "text-pv-success" : "text-pv-text-faint")}>{x.shut ? "admin down" : up ? "up" : "down"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pv-mono text-[12px] text-pv-text-muted">
            port counters: in {ctr.inF} (tagged {ctr.tagIn}) · out {ctr.outF} (tagged {ctr.tagOut}) · <span className={ctr.drops ? "text-pv-danger" : undefined}>dropped, no subinterface for that VID: {ctr.drops}</span>
          </p>
          <p className="text-[11.5px] text-pv-text-faint">The subinterface NUMBER is only a name (.10 by convention); the VLAN ID is what has to match the VLAN.</p>
        </div>
      )}
      {tab === "tables" && (
        <div className="space-y-2 p-3 text-[12.5px]">
          <p className="text-[11px] font-bold uppercase tracking-wide text-pv-text-faint">Connected routes</p>
          {r.subs.filter((x) => !x.shut && up).map((x) => (
            <p key={x.unit} className="pv-mono">
              {netOf(x.ip, x.prefix)}/{x.prefix} → {r1IfName(c.vendor, x.unit)}
            </p>
          ))}
          <p className="pt-1 text-[11px] font-bold uppercase tracking-wide text-pv-text-faint">ARP cache</p>
          {Object.keys((c.snap ?? s).arp.R1).length === 0 ? (
            <p className="text-pv-text-faint">Empty.</p>
          ) : (
            Object.entries((c.snap ?? s).arp.R1).map(([ip, mac]) => (
              <p key={ip} className="pv-mono">
                {ip} → {mac} ({vlMacName(s.cfg, mac)})
              </p>
            ))
          )}
        </div>
      )}
      {tab === "term" && <DevConsole c={c} dev="R1" />}
      {tab === "cap" && <CaptureView s={s} points={["R1 ge-0/0/0"]} vendor={c.vendor} />}
    </>
  );
}

const SPARE: { sw: VlSw; port: VlPort }[] = [
  { sw: "SW1", port: "ge-0/0/1" },
  { sw: "SW1", port: "ge-0/0/2" },
  { sw: "SW1", port: "ge-0/0/3" },
  { sw: "SW2", port: "ge-0/0/1" },
  { sw: "SW2", port: "ge-0/0/2" },
  { sw: "SW2", port: "ge-0/0/3" },
];
function HostUI({ c, h }: { c: VlDeskCtx; h: VlHost }) {
  const [tab, setTab] = useState<"nic" | "send" | "shell" | "cap">("nic");
  const s = c.view;
  const nic = s.cfg.hosts[h];
  const at = nic.at;
  const pc = at ? s.cfg.sw[at.sw].ports[at.port] : undefined;
  const targets = [...VL_HOSTS.filter((x) => x !== h).map((x) => ({ label: x, ip: s.cfg.hosts[x].ip })), ...s.cfg.r1.subs.map((x) => ({ label: `R1 .${x.unit}`, ip: x.ip }))].filter((t) => t.ip);
  const busy = !at || !nic.ip;
  return (
    <>
      <Tabs
        tabs={[
          ["nic", "Network card"],
          ["send", "Send"],
          ["shell", "Shell"],
          ["cap", "Capture"],
        ]}
        cur={tab}
        set={setTab}
      />
      {tab === "nic" && (
        <div className="space-y-2 p-3">
          <Kv k="MAC address" v={nic.mac} />
          <Kv k="IPv4 address" v={nic.ip ? `${nic.ip}/${nic.prefix}` : "none"} tone={nic.ip ? undefined : "warn"} />
          <Kv k="Default gateway" v={nic.gw || "none"} />
          <Kv k="VLAN setting on this host" v="none — hosts don't know VLANs" />
          <Kv k="Cable plugged into" v={at ? `${at.sw} ${vlPortName(c.vendor, at.port)}` : "nothing (unplugged)"} tone={at ? undefined : "warn"} />
          <Kv k="…so this host is in" v={!pc ? "no VLAN" : pc.mode === "access" ? `VLAN ${pc.access} (${vlanName(pc.access, s.cfg, at!.sw)})` : "a trunk port — it would receive tagged frames!"} tone={pc?.mode === "trunk" ? "bad" : "ok"} />
          <p className="text-[12.5px] text-pv-text-muted">The host sends ordinary untagged frames. Its VLAN is the access VLAN of the switch port at the other end of its cable — move the cable and it is in another broadcast domain, with the same IP settings. Change the address from the Shell tab (<span className="pv-mono">sudo ip addr …</span>).</p>
          <p className="pt-1 text-[11px] font-bold uppercase tracking-wide text-pv-text-faint">Move the cable</p>
          <div className="flex flex-wrap gap-1">
            {SPARE.filter((x) => !vlHostAt(s.cfg, x.sw, x.port) || vlHostAt(s.cfg, x.sw, x.port) === h).map((x) => {
              const here = at?.sw === x.sw && at.port === x.port;
              const p = s.cfg.sw[x.sw].ports[x.port];
              return (
                <button key={`${x.sw}${x.port}`} type="button" disabled={here} className={btn} onClick={() => c.act({ type: "move", host: h, to: x })}>
                  {here ? "✓ " : ""}
                  {x.sw} {vlPortName(c.vendor, x.port)} ({p.mode === "access" ? `VLAN ${p.access}` : "trunk"})
                </button>
              );
            })}
            {at && (
              <button type="button" className={btn} onClick={() => c.act({ type: "move", host: h })}>
                Unplug
              </button>
            )}
          </div>
        </div>
      )}
      {tab === "send" && (
        <div className="space-y-2 p-3">
          <p className="text-[12.5px] text-pv-text-muted">A ping to a host in this host&apos;s own subnet goes straight there (ARP for it first). Anything else goes to the default gateway — R1 in this VLAN.</p>
          <div className="flex flex-wrap gap-1">
            {targets.map((t) => (
              <button key={t.label} type="button" className={btn} disabled={busy} onClick={() => c.act({ type: "traffic", sends: [{ from: h, to: t.ip, kind: "ping" }] })}>
                Ping {t.label} <span className="pv-mono text-[11px] text-pv-text-faint">{t.ip}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {targets.filter((t) => t.label.startsWith("HOST")).map((t) => (
              <button key={t.label} type="button" className={btn} disabled={busy} onClick={() => c.act({ type: "traffic", sends: [{ from: h, to: t.ip, kind: "arp" }] })}>
                ARP: who has {t.ip}?
              </button>
            ))}
          </div>
          {busy && <p className="text-[12px] text-pv-warning">{!at ? "Unplugged: nothing can be sent." : "No IP address: add one in the Shell tab."}</p>}
        </div>
      )}
      {tab === "shell" && <DevConsole c={c} dev={h} />}
      {tab === "cap" && <CaptureView s={s} points={[h]} vendor={c.vendor} />}
    </>
  );
}

const SUB = (c: VlDeskCtx, id: VlDev) => (isSw(id) ? `802.1Q switch · ${c.vendor === "cisco" ? "Cisco IOS" : "Junos"} view` : id === "R1" ? `Router on a stick · ${c.vendor === "cisco" ? "Cisco IOS" : "Junos"} view` : `${c.view.cfg.hosts[id].ip || "no address"} · Linux`);
function Win({ w, c, narrow, focused, onFocus, onMove, onMin, onClose }: { w: VlWin; c: VlDeskCtx; narrow: boolean; focused: boolean; onFocus: () => void; onMove: (x: number, y: number) => void; onMin: () => void; onClose: () => void }) {
  const drag = useRef<{ dx: number; dy: number } | undefined>(undefined);
  const tone = isSw(w.id) ? "#22d3ee" : w.id === "R1" ? "#f59e0b" : "#34d399";
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
      style={narrow ? { zIndex: 100 + w.z } : { left: w.x, top: w.y, width: "min(820px, calc(100vw - 32px))", height: "min(640px, calc(100vh - 96px))", zIndex: 100 + w.z, resize: "both" }}
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
          {isSw(w.id) ? "⇄" : w.id === "R1" ? "R" : "💻"}
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
      <div className="min-h-0 flex-1 overflow-y-auto">{isSw(w.id) ? <SwitchUI c={c} sw={w.id} /> : w.id === "R1" ? <RouterUI c={c} /> : <HostUI c={c} h={w.id} />}</div>
    </section>
  );
}

export function VlDesk({ windows, setWindows, focus, setFocus, ctx }: { windows: VlWin[]; setWindows: (u: (w: VlWin[]) => VlWin[]) => void; focus?: VlDev; setFocus: (n: VlDev | undefined) => void; ctx: VlDeskCtx }) {
  const narrow = useNarrow();
  if (typeof document === "undefined" || !windows.length) return null;
  const top = Math.max(0, ...windows.map((w) => w.z));
  const raise = (id: VlDev) => {
    setFocus(id);
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, z: top + 1, minimized: false } : w)));
  };
  const minimize = (id: VlDev) => (setWindows((ws) => ws.map((v) => (v.id === id ? { ...v, minimized: true } : v))), setFocus(undefined));
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
export function openVlWindow(ws: VlWin[], id: VlDev): VlWin[] {
  const top = Math.max(0, ...ws.map((w) => w.z));
  if (ws.some((w) => w.id === id)) return ws.map((w) => (w.id === id ? { ...w, minimized: false, z: top + 1 } : w));
  const n = ws.length;
  const x = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerWidth - 840, 40 + n * 36));
  const y = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerHeight - 660, 90 + n * 30));
  return [...ws, { id, minimized: false, x, y, z: top + 1 }];
}
