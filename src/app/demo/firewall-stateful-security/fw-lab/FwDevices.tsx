"use client";

import { clsx } from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CliVendor } from "@/lib/cli/types";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { ConsoleTerminal, EMPTY_SESSION, type ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import { APPS, FW_HOSTS, FW_IF, FW_ZONES, HOST_IP, HOST_ROLE, ISP_IP, LISTEN, OBJECT_NAMES, OBJECTS, fwClone, hitKey, isHost, type FwAction, type FwApp, type FwCap, type FwCfg, type FwDev, type FwHost, type FwNet, type FwRule, type FwZone, type SnatMode } from "@/lib/sim-engine/scenarios/fwNet";
import { fwFirewallSets, fwHostSet, fwIspSets, fwJunosConfig, type FwCand, type FwCliApi, type FwIosMode } from "./fwCli";
import { JUNOS_APP, fwVendorText, ifName, zoneName } from "./fwNames";
import { Card, Sessions, TARGETS } from "./FwPanels";

/**
 * Firewall Lab devices (drag, minimize to a tray; full screen on phones).
 *   FW1   Policies (every rule per zone pair: order, source, destination, application, action — change any of it, add
 *         or delete rules) · NAT · Sessions · Log · Routes · Cisco/Junos console · capture on each interface
 *   ISP   the provider's routes (read-only), looking glass, capture
 *   Hosts send (HTTPS, HTTP, SSH, ping) · shell · capture; the DMZ server's gateway
 */
export interface FwDeskCtx {
  view: FwNet;
  act: (a: FwAction) => FwNet;
  vendor: CliVendor;
  setVendor: (v: CliVendor) => void;
  ios: FwIosMode;
  setIos: (m: FwIosMode) => void;
  junosEdit: boolean;
  setJunosEdit: (b: boolean) => void;
  cand: FwCand;
  setCand: (c: FwCand) => void;
  spare: FwRule[];
  setSpare: (r: FwRule[]) => void;
  consoles: Record<string, ConsoleSession>;
  setConsoles: (u: (m: Record<string, ConsoleSession>) => Record<string, ConsoleSession>) => void;
  notes: boolean;
  setNotes: (b: boolean) => void;
  question?: CliQuestion;
  setQuestion: (q: CliQuestion | undefined) => void;
}
export interface FwWin {
  id: FwDev;
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
export const capPoints = (): string[] => [...FW_HOSTS.slice(0, 3), ...FW_ZONES.map((z) => `FW1 ${z}`), "ISP", "WEB", "OUT"];
export const capLabel = (vendor: CliVendor, p: string) => (p.startsWith("FW1 ") ? `FW1 ${ifName(vendor, FW_IF[p.slice(4) as FwZone].ifn)} (${zoneName(vendor, p.slice(4) as FwZone)})` : p);
const pktText = (c: FwCap) => (c.pkt.proto === "icmp" ? `ICMP ${c.pkt.icmp}` : `TCP ${c.pkt.flags}`);
export function CaptureView({ s, points, initial, vendor }: { s: FwNet; points: string[]; initial?: string; vendor: CliVendor }) {
  const [point, setPoint] = useState<string>(initial && points.includes(initial) ? initial : points[0]);
  const [onlyLast, setOnlyLast] = useState(true);
  const [pick, setPick] = useState<FwCap | undefined>(undefined);
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
                <tr key={c.n} onClick={() => setPick(c)} className={clsx("cursor-pointer border-t border-pv-border/50 hover:bg-white/[0.03]", pick?.n === c.n && "bg-pv-cyan/10", c.pkt.flags === "RST" && "text-pv-danger")}>
                  <td className="px-1.5 py-0.5">{c.n}</td>
                  <td className="px-1.5 py-0.5">{c.dir}</td>
                  <td className="px-1.5 py-0.5">
                    {c.pkt.src}
                    {c.pkt.proto === "tcp" ? `:${c.pkt.sport}` : ""} → {c.pkt.dst}
                    {c.pkt.proto === "tcp" ? `:${c.pkt.dport}` : ""}
                  </td>
                  <td className="px-1.5 py-0.5 font-sans">
                    {pktText(c)} · TTL {c.pkt.ttl}
                  </td>
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
            <Kv k="IP protocol · TTL" v={`${pick.pkt.proto === "tcp" ? "6 (TCP)" : "1 (ICMP)"} · ${pick.pkt.ttl}`} />
            {pick.pkt.proto === "tcp" ? <Kv k="TCP ports · flags" v={`${pick.pkt.sport} → ${pick.pkt.dport} · ${pick.pkt.flags}`} /> : <Kv k="ICMP" v={`${pick.pkt.icmp === "echo" ? "8 echo request" : "0 echo reply"} · id ${pick.pkt.sport}`} />}
            <Kv k="captured" v={`${capLabel(vendor, pick.point)} · ${pick.dir}`} />
          </div>
          {pick.point.startsWith("FW1") && <p className="mt-1 text-[11.5px] text-pv-text-muted">Compare the same packet on two FW1 interfaces: source NAT changes the source on the way out; destination NAT changes the destination on the way in.</p>}
        </div>
      )}
    </div>
  );
}
function cliApi(c: FwDeskCtx, key: string): FwCliApi {
  return { view: c.view, act: c.act, ios: c.ios, setIos: c.setIos, junosEdit: c.junosEdit, setJunosEdit: c.setJunosEdit, cand: c.cand, setCand: c.setCand, spare: c.spare, setSpare: c.setSpare, ask: c.setQuestion, history: c.consoles[key]?.history ?? [] };
}
export function DevConsole({ c, dev, className }: { c: FwDeskCtx; dev: FwDev; className?: string }) {
  const host = isHost(dev);
  const os = host ? "linux" : c.vendor === "cisco" ? "ios" : "junos";
  const key = `${dev}:${os}`;
  const api = cliApi(c, key);
  const sets = host ? { cisco: fwHostSet(api, dev), juniper: fwHostSet(api, dev) } : dev === "FW1" ? fwFirewallSets(api) : fwIspSets();
  return <ConsoleTerminal key={key} sets={sets} vendor={c.vendor} setVendor={host ? undefined : c.setVendor} os={os} host={dev} session={c.consoles[key] ?? EMPTY_SESSION} setSession={(u) => c.setConsoles((m) => ({ ...m, [key]: u(m[key] ?? EMPTY_SESSION) }))} notes={c.notes} setNotes={c.setNotes} question={c.question?.node === dev ? c.question : undefined} pipeCtx={dev === "FW1" ? { config: fwJunosConfig(api), rollbacks: 1 } : undefined} className={className ?? "h-[min(440px,58vh)]"} />;
}
const ALL_PAIRS: [FwZone, FwZone][] = FW_ZONES.flatMap((f) => FW_ZONES.filter((t) => t !== f).map((t) => [f, t] as [FwZone, FwZone]));
function PolicyEditor({ c }: { c: FwDeskCtx }) {
  const s = c.view;
  const v = c.vendor;
  const [np, setNp] = useState("trust>untrust");
  const [nsrc, setNsrc] = useState("CLIENTS");
  const [ndst, setNdst] = useState("any");
  const [napp, setNapp] = useState<FwApp>("ssh");
  const [nact, setNact] = useState<"permit" | "deny">("permit");
  const apply = (f: (cfg: FwCfg) => void, text: string) => {
    const cfg = fwClone(s.cfg);
    f(cfg);
    c.act({ type: "cfg", cfg, text: `FW1: ${text}` });
  };
  const pairs = ALL_PAIRS.filter(([f, t]) => s.cfg.rules.some((r) => r.from === f && r.to === t));
  const move = (r: FwRule, d: -1 | 1) =>
    apply((cfg) => {
      const same = cfg.rules.filter((x) => x.from === r.from && x.to === r.to);
      const i = same.findIndex((x) => x.name === r.name);
      const j = i + d;
      if (j < 0 || j >= same.length) return;
      const a = cfg.rules.findIndex((x) => x.name === same[i].name);
      const b = cfg.rules.findIndex((x) => x.name === same[j].name);
      [cfg.rules[a], cfg.rules[b]] = [cfg.rules[b], cfg.rules[a]];
    }, `${r.name} moved ${d < 0 ? "up" : "down"}`);
  const objOpts = (cur: string[]) => [...new Set([...(cur.length > 1 ? [cur.join(",")] : []), "any", ...OBJECT_NAMES])];
  return (
    <div className="space-y-3 p-3">
      <p className="text-[12.5px] text-pv-text-muted">{v === "cisco" ? "Each zone-pair has an inspect policy-map; its classes (one per rule) are checked top-down, then class-default drops." : "Each zone pair has its own policy list, checked top-down; then the default policy denies."} The first match decides — order matters.</p>
      {pairs.map(([f, t]) => (
        <div key={`${f}${t}`} className="space-y-1">
          <p className="text-[12.5px] font-semibold text-pv-text">
            {zoneName(v, f)} → {zoneName(v, t)}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-[12px]">
              <tbody>
                {s.cfg.rules
                  .filter((r) => r.from === f && r.to === t)
                  .map((r, i, arr) => (
                    <tr key={r.name} className="border-t border-pv-border/50">
                      <td className="w-5 px-1 py-1 text-pv-text-faint">{i + 1}</td>
                      <td className="pv-mono px-1 py-1 font-semibold text-pv-text">{r.name}</td>
                      <td className="px-1 py-1">
                        <select aria-label={`${r.name} source`} className={sel} value={r.src.length > 1 ? r.src.join(",") : (r.src[0] ?? "any")} onChange={(e) => apply((cfg) => (cfg.rules.find((x) => x.name === r.name)!.src = e.target.value.split(",")), `${r.name} source ${e.target.value}`)}>
                          {objOpts(r.src).map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1 py-1 text-pv-text-faint">→</td>
                      <td className="px-1 py-1">
                        <select aria-label={`${r.name} destination`} className={sel} value={r.dst.length > 1 ? r.dst.join(",") : (r.dst[0] ?? "any")} onChange={(e) => apply((cfg) => (cfg.rules.find((x) => x.name === r.name)!.dst = e.target.value.split(",")), `${r.name} destination ${e.target.value}`)}>
                          {objOpts(r.dst).map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1 py-1">
                        <select aria-label={`${r.name} application`} className={sel} value={r.app} onChange={(e) => apply((cfg) => (cfg.rules.find((x) => x.name === r.name)!.app = e.target.value as FwApp), `${r.name} application ${e.target.value}`)}>
                          {APPS.map((a) => (
                            <option key={a} value={a}>
                              {v === "juniper" ? JUNOS_APP[a] : a}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1 py-1">
                        <select aria-label={`${r.name} action`} className={clsx(sel, r.action === "deny" && "text-pv-warning")} value={r.action} onChange={(e) => apply((cfg) => (cfg.rules.find((x) => x.name === r.name)!.action = e.target.value as "permit" | "deny"), `${r.name} ${e.target.value}`)}>
                          <option value="permit">{v === "cisco" ? "inspect" : "permit"}</option>
                          <option value="deny">{v === "cisco" ? "drop" : "deny"}</option>
                        </select>
                      </td>
                      <td className="pv-mono px-1 py-1 text-[11px] text-pv-text-faint">{s.hits[hitKey(f, t, r.name)] ?? 0} hits</td>
                      <td className="whitespace-nowrap px-1 py-1">
                        <button type="button" aria-label={`Move ${r.name} up`} className={btn} disabled={i === 0} onClick={() => move(r, -1)}>
                          ↑
                        </button>{" "}
                        <button type="button" aria-label={`Move ${r.name} down`} className={btn} disabled={i === arr.length - 1} onClick={() => move(r, 1)}>
                          ↓
                        </button>{" "}
                        <button type="button" aria-label={`Delete ${r.name}`} className={btn} onClick={() => apply((cfg) => (cfg.rules = cfg.rules.filter((x) => x.name !== r.name)), `${r.name} deleted`)}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                <tr className="border-t border-pv-border/50 text-pv-text-faint">
                  <td className="px-1 py-1" colSpan={9}>
                    {v === "cisco" ? "class-default → drop" : "default policy → deny-all"} · {s.hits[hitKey(f, t)] ?? 0} hits
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <Card title="Add a rule (at the end of its zone pair)">
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <select aria-label="New rule zone pair" className={sel} value={np} onChange={(e) => setNp(e.target.value)}>
            {ALL_PAIRS.map(([f, t]) => (
              <option key={`${f}${t}`} value={`${f}>${t}`}>
                {zoneName(v, f)} → {zoneName(v, t)}
              </option>
            ))}
          </select>
          <select aria-label="New rule source" className={sel} value={nsrc} onChange={(e) => setNsrc(e.target.value)}>
            {["any", ...OBJECT_NAMES].map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
          →
          <select aria-label="New rule destination" className={sel} value={ndst} onChange={(e) => setNdst(e.target.value)}>
            {["any", ...OBJECT_NAMES].map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
          <select aria-label="New rule application" className={sel} value={napp} onChange={(e) => setNapp(e.target.value as FwApp)}>
            {APPS.map((a) => (
              <option key={a} value={a}>
                {v === "juniper" ? JUNOS_APP[a] : a}
              </option>
            ))}
          </select>
          <select aria-label="New rule action" className={sel} value={nact} onChange={(e) => setNact(e.target.value as "permit" | "deny")}>
            <option value="permit">{v === "cisco" ? "inspect" : "permit"}</option>
            <option value="deny">{v === "cisco" ? "drop" : "deny"}</option>
          </select>
          <button
            type="button"
            className={btn}
            onClick={() => {
              const [f, t] = np.split(">") as [FwZone, FwZone];
              let n = 1;
              while (s.cfg.rules.some((r) => r.name === `RULE-${n}`)) n++;
              apply((cfg) => cfg.rules.push({ name: `RULE-${n}`, from: f, to: t, src: [nsrc], dst: [ndst], app: napp, action: nact }), `RULE-${n} added (${f} → ${t})`);
            }}
          >
            Add
          </button>
        </div>
        <p className="text-[11.5px] text-pv-text-muted">Objects: {Object.entries(OBJECTS).map(([k, x]) => `${k} ${x}`).join(" · ")}</p>
      </Card>
    </div>
  );
}
function FirewallUI({ c }: { c: FwDeskCtx }) {
  const [tab, setTab] = useState<"pol" | "nat" | "sess" | "log" | "route" | "term" | "cap">("pol");
  const s = c.view;
  const v = c.vendor;
  const setNat = (patch: Partial<FwCfg>, text: string) => c.act({ type: "cfg", cfg: { ...fwClone(s.cfg), ...patch }, text: `FW1: ${text}` });
  return (
    <>
      <Tabs
        tabs={[
          ["pol", "Policies"],
          ["nat", "NAT"],
          ["sess", "Sessions"],
          ["log", "Log"],
          ["route", "Routes"],
          ["term", "Console"],
          ["cap", "Capture"],
        ]}
        cur={tab}
        set={setTab}
      />
      {tab === "pol" && <PolicyEditor c={c} />}
      {tab === "nat" && (
        <div className="space-y-2 p-3">
          {(["trust", "dmz"] as const).map((z) => (
            <label key={z} className="flex flex-wrap items-center justify-between gap-2 border-b border-pv-border/50 py-1 text-[12.5px] text-pv-text-muted">
              Source NAT {zoneName(v, z)} → {zoneName(v, "untrust")} ({z === "trust" ? "10.10.10.0/24" : "172.16.0.0/24"})
              <select aria-label={`Source NAT ${z}`} className={sel} value={s.cfg.snat[z]} onChange={(e) => setNat({ snat: { ...s.cfg.snat, [z]: e.target.value as SnatMode } }, `source NAT ${z} → ${e.target.value}`)}>
                <option value="interface">interface {FW_IF.untrust.ip}</option>
                <option value="bad">BAD-POOL 198.51.100.99</option>
                <option value="off">none</option>
              </select>
            </label>
          ))}
          <label className="flex flex-wrap items-center justify-between gap-2 border-b border-pv-border/50 py-1 text-[12.5px] text-pv-text-muted">
            Destination NAT {FW_IF.untrust.ip}:443 → {HOST_IP.DMZ}:443
            <input type="checkbox" aria-label="Destination NAT" checked={s.cfg.dnat} onChange={(e) => setNat({ dnat: e.target.checked }, e.target.checked ? "destination NAT on" : "destination NAT off")} />
          </label>
          <p className="text-[11.5px] text-pv-text-muted">Source NAT happens after the policy, on the way out; destination NAT before the route and policy lookups, on the way in. The ISP routes only 198.51.100.0/30 to you.</p>
        </div>
      )}
      {tab === "sess" && (
        <div className="space-y-2 p-3">
          <Sessions s={s} max={30} />
          <button type="button" className={btn} onClick={() => c.act({ type: "clear" })}>
            Clear sessions
          </button>
          <p className="text-[11.5px] text-pv-text-muted">A reply is let in because it matches a session in reverse — no inbound rule needed. SYN_SENT that never reaches ESTABLISHED: the reply never came back.</p>
        </div>
      )}
      {tab === "log" && (
        <div className="space-y-1 p-3 text-[12px]">
          {s.fwlog.length === 0 ? (
            <p className="text-pv-text-faint">No events.</p>
          ) : (
            [...s.fwlog]
              .reverse()
              .slice(0, 50)
              .map((x, k) => (
                <p key={k} className={clsx("pv-mono", x.kind === "create" ? "text-pv-success" : x.kind === "close" ? "text-pv-text-muted" : "text-pv-danger")}>
                  t={x.clock - 36000}s · {x.kind === "create" ? "SESSION" : x.kind === "close" ? "CLOSE" : "DENY"} {x.pkt.proto === "tcp" ? `${x.pkt.src}:${x.pkt.sport} → ${x.pkt.dst}:${x.pkt.dport}` : `${x.pkt.src} → ${x.pkt.dst} icmp`} · {fwVendorText(v, x.text)}
                </p>
              ))
          )}
        </div>
      )}
      {tab === "route" && (
        <div className="space-y-1 p-3 text-[12px]">
          {FW_ZONES.map((z) => (
            <Kv key={z} k={`${FW_IF[z].net} connected`} v={`${ifName(v, FW_IF[z].ifn)} · ${zoneName(v, z)} · ${FW_IF[z].ip}`} />
          ))}
          <Kv k="0.0.0.0/0 static" v={`via ${ISP_IP.fw} (${ifName(v, FW_IF.untrust.ifn)})`} />
          <p className="text-[11.5px] text-pv-text-muted">The route lookup decides the egress interface — and so the destination zone the policy is chosen for.</p>
        </div>
      )}
      {tab === "term" && <DevConsole c={c} dev="FW1" />}
      {tab === "cap" && <CaptureView s={s} points={FW_ZONES.map((z) => `FW1 ${z}`)} initial="FW1 untrust" vendor={v} />}
    </>
  );
}
function IspUI({ c }: { c: FwDeskCtx }) {
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
          <Kv k="198.51.100.0/30 connected" v="→ FW1 (assigned to you)" />
          <Kv k="203.0.113.0/24 connected" v="WEB, OUT" />
          <p className="text-[11.5px] text-pv-text-muted">Nothing else: no route to 10.0.0.0/8, 172.16.0.0/12 or any address outside your /30. Not your router — read-only.</p>
        </div>
      )}
      {tab === "term" && <DevConsole c={c} dev="ISP" />}
      {tab === "cap" && <CaptureView s={c.view} points={["ISP"]} vendor={c.vendor} />}
    </>
  );
}
function HostUI({ c, h }: { c: FwDeskCtx; h: FwHost }) {
  const [tab, setTab] = useState<"send" | "shell" | "cap">("send");
  const s = c.view;
  const zone = h === "CLIENT" || h === "LAB" ? "trust" : h === "DMZ" ? "dmz" : undefined;
  const send = (to: string, kind: "connect" | "ping", port?: number) => c.act({ type: "traffic", sends: [{ from: h, to, kind, port }] });
  const targets = TARGETS.filter((t) => t.ip !== HOST_IP[h]);
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
          <Kv k="IPv4 · gateway" v={`${HOST_IP[h]} · ${h === "DMZ" ? s.cfg.dmzGw : zone ? FW_IF[zone].ip : ISP_IP.lan}`} />
          <Kv k="listening" v={LISTEN[h].length ? LISTEN[h].map((p) => `TCP/${p}`).join(", ") : "nothing"} />
          {h === "DMZ" && (
            <label className="flex items-center justify-between gap-2 text-[12.5px] text-pv-text-muted">
              default gateway
              <select aria-label="DMZ gateway" className={sel} value={s.cfg.dmzGw} onChange={(e) => c.act({ type: "cfg", cfg: { ...fwClone(s.cfg), dmzGw: e.target.value }, text: `DMZ: default via ${e.target.value}` })}>
                <option value="172.16.0.1">172.16.0.1 (FW1)</option>
                <option value="172.16.0.254">172.16.0.254</option>
              </select>
            </label>
          )}
          {targets.map((t) => (
            <div key={t.ip} className="flex flex-wrap items-center gap-1">
              <span className="w-[170px] text-[12px] text-pv-text-muted">{t.label}</span>
              <button type="button" className={btn} onClick={() => send(t.ip, "connect", 443)}>
                HTTPS
              </button>
              <button type="button" className={btn} onClick={() => send(t.ip, "connect", 80)}>
                HTTP
              </button>
              <button type="button" className={btn} onClick={() => send(t.ip, "connect", 22)}>
                SSH
              </button>
              <button type="button" className={btn} onClick={() => send(t.ip, "ping")}>
                ping
              </button>
            </div>
          ))}
          {s.last && s.last.results[0]?.send.from === h && <p className={clsx("text-[12px]", s.last.results[0].ok ? "text-pv-success" : "text-pv-danger")}>{fwVendorText(c.vendor, `${s.last.cmd}: ${s.last.results[0].outcome}${s.last.results[0].fail ? ` — ${s.last.results[0].fail}` : ""}`)}</p>}
        </div>
      )}
      {tab === "shell" && <DevConsole c={c} dev={h} />}
      {tab === "cap" && <CaptureView s={s} points={[h]} vendor={c.vendor} />}
    </>
  );
}

function Win({ w, c, narrow, focused, onFocus, onMove, onMin, onClose }: { w: FwWin; c: FwDeskCtx; narrow: boolean; focused: boolean; onFocus: () => void; onMove: (x: number, y: number) => void; onMin: () => void; onClose: () => void }) {
  const drag = useRef<{ dx: number; dy: number } | undefined>(undefined);
  const tone = w.id === "FW1" ? "#f87171" : w.id === "ISP" ? "#a78bfa" : "#34d399";
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
          {w.id === "FW1" ? "FW" : w.id === "ISP" ? "R" : "💻"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-bold text-pv-text">
            {w.id}
            {isHost(w.id) ? ` · ${HOST_ROLE[w.id]}` : w.id === "ISP" ? " · provider" : ""}
          </p>
          <p className="truncate text-[11px] text-pv-text-faint">{w.id === "FW1" ? `stateful firewall · ${c.vendor === "cisco" ? "Cisco IOS zone-based firewall" : "Junos SRX"} view` : w.id === "ISP" ? "read-only looking glass" : `${HOST_IP[w.id as FwHost]} · Linux`}</p>
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
      <div className="min-h-0 flex-1 overflow-y-auto">{w.id === "FW1" ? <FirewallUI c={c} /> : w.id === "ISP" ? <IspUI c={c} /> : <HostUI c={c} h={w.id as FwHost} />}</div>
    </section>
  );
}
export function FwDesk({ windows, setWindows, focus, setFocus, ctx }: { windows: FwWin[]; setWindows: (u: (w: FwWin[]) => FwWin[]) => void; focus?: FwDev; setFocus: (n: FwDev | undefined) => void; ctx: FwDeskCtx }) {
  const narrow = useNarrow();
  if (typeof document === "undefined" || !windows.length) return null;
  const top = Math.max(0, ...windows.map((w) => w.z));
  const raise = (id: FwDev) => {
    setFocus(id);
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, z: top + 1, minimized: false } : w)));
  };
  const minimize = (id: FwDev) => (setWindows((ws) => ws.map((v) => (v.id === id ? { ...v, minimized: true } : v))), setFocus(undefined));
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
export function openFwWindow(ws: FwWin[], id: FwDev): FwWin[] {
  const top = Math.max(0, ...ws.map((w) => w.z));
  if (ws.some((w) => w.id === id)) return ws.map((w) => (w.id === id ? { ...w, minimized: false, z: top + 1 } : w));
  const n = ws.length;
  const x = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerWidth - 920, 40 + n * 36));
  const y = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerHeight - 660, 90 + n * 30));
  return [...ws, { id, minimized: false, x, y, z: top + 1 }];
}
