"use client";

import { clsx } from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CliVendor } from "@/lib/cli/types";
import { TN_ADDR, TN_POINTS, flagsText, pktName, tcpdumpFlags, tnClone, tnSockets, type TnAction, type TnCap, type TnCfg, type TnDev, type TnPoint, type TnSnap, type TnState } from "@/lib/sim-engine/scenarios/tcpNet";
import { ConsoleTerminal, EMPTY_SESSION, type ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import { tcpLaptopSet, tcpR1Sets, tcpServerSet, iosAclLine, type TcpCliApi, type TcpIosMode } from "./tcpCli";
import { StatePill } from "./TcpTopology";

/**
 * TCP/UDP lab devices, Packet Tracer style (drag, minimize to a tray, resize; full screen on phones).
 *   Laptop: its address, its sockets (live while a test plays), a Linux terminal, a capture of its NIC.
 *   Server: its services (start / stop — what listens on which port), its sockets, its firewall, its gateway, a Linux
 *           terminal, a capture of its NIC.
 *   R1: interfaces and counters (CRC errors), its ACL and what each line matched, a Cisco/Junos console, a capture on
 *       each interface — and no socket table, because a router keeps no TCP state.
 * Every number is read from the lab state; every change goes through the model.
 */

export interface TcpDeskCtx {
  view: TnState;
  /** Sockets at the moment the topology is showing (during playback), else the current ones. */
  snap?: TnSnap;
  act: (a: TnAction) => TnState;
  vendor: CliVendor;
  setVendor: (v: CliVendor) => void;
  ios: TcpIosMode;
  setIos: (m: TcpIosMode) => void;
  junosEdit: boolean;
  setJunosEdit: (b: boolean) => void;
  cand: TnCfg["r1"];
  setCand: (c: TnCfg["r1"]) => void;
  consoles: Record<string, ConsoleSession>;
  setConsoles: (u: (m: Record<string, ConsoleSession>) => Record<string, ConsoleSession>) => void;
  notes: boolean;
  setNotes: (b: boolean) => void;
}
export interface TcpWin {
  id: TnDev;
  minimized: boolean;
  x: number;
  y: number;
  z: number;
}
const NAME: Record<TnDev, string> = { laptop: "Laptop", r1: "R1", server: "Server" };
export const POINT_LABEL: Record<TnPoint, string> = { laptop: "Laptop eth0", "r1:gi0": "R1 Gi0/0 (LAN side)", "r1:gi1": "R1 Gi0/1 (Server side)", server: "Server eth0" };

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
const btn = "rounded-full border border-pv-border px-2.5 py-0.5 text-[12px] font-semibold text-pv-text-muted hover:border-pv-cyan/60 hover:text-pv-text";

// ---------------------------------------------------------------------------------------------------------------
// Captures
// ---------------------------------------------------------------------------------------------------------------
const what = (c: TnCap) => {
  const p = c.pkt;
  if (p.proto === "tcp") return `${p.retx ? "↻ " : ""}${tcpdumpFlags(p.tcp!.flags)} ${pktName(p)}`;
  if (p.proto === "udp") return pktName(p);
  return pktName(p);
};
export function CaptureView({ s, points, initial }: { s: TnState; points: TnPoint[]; initial?: TnPoint }) {
  const [point, setPoint] = useState<TnPoint>(initial ?? points[0]);
  const [onlyLast, setOnlyLast] = useState(true);
  const [pick, setPick] = useState<TnCap | undefined>(undefined);
  const t0 = s.last?.start ?? 0;
  const rows = s.captures.filter((c) => c.point === point && (!onlyLast || !s.last || c.n >= s.last.capFrom)).slice(-80);
  return (
    <div className="space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-pv-text-muted">
        {points.length > 1 &&
          points.map((p) => (
            <button key={p} type="button" aria-pressed={point === p} onClick={() => (setPoint(p), setPick(undefined))} className={clsx("rounded-full border px-2.5 py-0.5 font-semibold", point === p ? "border-pv-cyan bg-pv-cyan/15 text-pv-text" : "border-pv-border")}>
              {POINT_LABEL[p]}
            </button>
          ))}
        <label className="ml-auto flex items-center gap-1">
          <input type="checkbox" checked={onlyLast} onChange={(e) => setOnlyLast(e.target.checked)} /> last test only
        </label>
      </div>
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-pv-text-faint">Nothing captured on {POINT_LABEL[point]}{onlyLast ? " during the last test" : ""}. Silence here is evidence too: nothing crossed this interface.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-[12px]">
            <thead className="text-[11px] text-pv-text-faint">
              <tr>
                <th className="px-1.5 py-1">#</th>
                <th className="px-1.5 py-1">time</th>
                <th className="px-1.5 py-1">dir</th>
                <th className="px-1.5 py-1">source → destination</th>
                <th className="px-1.5 py-1">what</th>
                <th className="px-1.5 py-1">seq</th>
                <th className="px-1.5 py-1">ack</th>
                <th className="px-1.5 py-1">len</th>
              </tr>
            </thead>
            <tbody className="pv-mono">
              {rows.map((c) => {
                const port = (x: number | undefined) => (x === undefined ? "" : `:${x}`);
                const sp = c.pkt.tcp?.sport ?? c.pkt.udp?.sport;
                const dp = c.pkt.tcp?.dport ?? c.pkt.udp?.dport;
                return (
                  <tr key={c.n} onClick={() => setPick(c)} className={clsx("cursor-pointer border-t border-pv-border/50 hover:bg-white/[0.03]", pick?.n === c.n && "bg-pv-cyan/10", c.note && "text-pv-danger", c.pkt.tcp?.flags.includes("RST") && "text-pv-danger", c.pkt.retx && "text-pv-warning")}>
                    <td className="px-1.5 py-0.5">{c.n}</td>
                    <td className="px-1.5 py-0.5">{((c.t - t0) / 1000).toFixed(3)}</td>
                    <td className="px-1.5 py-0.5">{c.dir}</td>
                    <td className="px-1.5 py-0.5">
                      {c.pkt.src}
                      {port(sp)} → {c.pkt.dst}
                      {port(dp)}
                    </td>
                    <td className="px-1.5 py-0.5">
                      {what(c)}
                      {c.note ? " ✕" : ""}
                    </td>
                    <td className="px-1.5 py-0.5">{c.pkt.tcp?.seq ?? ""}</td>
                    <td className="px-1.5 py-0.5">{c.pkt.tcp?.ack ?? ""}</td>
                    <td className="px-1.5 py-0.5">{c.pkt.tcp?.len ?? c.pkt.udp?.len ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pick && <PacketDetail c={pick} t0={t0} />}
    </div>
  );
}
function PacketDetail({ c, t0 }: { c: TnCap; t0: number }) {
  const p = c.pkt;
  const h = p.tcp;
  const flagMeaning: Record<string, string> = { SYN: "synchronize: start a connection, here is my ISN", ACK: "the acknowledgment field is valid", FIN: "I have finished sending", RST: "reset: abort / refuse", PSH: "push the data to the application" };
  return (
    <div className="rounded-xl border border-pv-border bg-pv-bg/60 p-2.5 text-[12.5px]">
      <p className="font-semibold text-pv-text">
        #{c.n} on {POINT_LABEL[c.point]} ({c.dir === "in" ? "received" : "sent"}) at {((c.t - t0) / 1000).toFixed(3)} s
      </p>
      <div className="mt-1 grid gap-x-4 sm:grid-cols-2">
        <Kv k="IPv4 source → destination" v={`${p.src} → ${p.dst}`} />
        <Kv k="TTL" v={p.ttl} />
        <Kv k="Protocol" v={p.proto === "tcp" ? "6 (TCP)" : p.proto === "udp" ? "17 (UDP)" : "1 (ICMP)"} />
        {h && (
          <>
            <Kv k="Source port → destination port" v={`${h.sport} → ${h.dport}`} />
            <Kv k="Sequence number" v={`${h.seq}${h.len || h.flags.includes("SYN") || h.flags.includes("FIN") ? ` (covers ${h.seq}–${h.seq + h.len + (h.flags.includes("SYN") || h.flags.includes("FIN") ? 1 : 0) - 1})` : ""}`} />
            <Kv k="Acknowledgment number" v={h.ack !== undefined ? `${h.ack} = the next byte the sender expects` : "— (ACK flag clear)"} />
            <Kv k="Flags" v={flagsText(h.flags)} tone={h.flags.includes("RST") ? "bad" : undefined} />
            <Kv k="Payload" v={h.len ? `${h.len} bytes${h.data ? ` (${h.data})` : ""}` : "none"} />
            {p.retx && <Kv k="Retransmission" v="same bytes, same sequence number, sent again" tone="warn" />}
          </>
        )}
        {p.udp && (
          <>
            <Kv k="Source port → destination port" v={`${p.udp.sport} → ${p.udp.dport}`} />
            <Kv k="Length" v={`${p.udp.len} bytes`} />
            <Kv k="Contents (lab data)" v={p.udp.data} />
            <Kv k="Sequence / ACK / flags" v="none — UDP has no such fields" />
          </>
        )}
        {p.icmp && <Kv k="ICMP type / code" v={`${p.icmp.type} / ${p.icmp.code}${p.icmp.quote ? ` — about ${p.icmp.quote.proto.toUpperCase()} ${p.icmp.quote.sport} → ${p.icmp.quote.dport}` : ""}`} />}
      </div>
      {h && <p className="mt-1.5 text-[11.5px] text-pv-text-muted">{h.flags.map((f) => `${f}: ${flagMeaning[f]}`).join(" · ")}</p>}
      {c.note && <p className="mt-1.5 font-semibold text-pv-danger">{c.note}</p>}
    </div>
  );
}

/** The last test, packet by packet, against the four capture points: where each packet was seen — and where not. */
export function PathTrace({ s }: { s: TnState }) {
  const last = s.last;
  if (!last || last.tool === "sleep") return <p className="text-[12.5px] text-pv-text-faint">Run a test first: each packet of it will be listed here against the four capture points.</p>;
  const caps = s.captures.filter((c) => c.n >= last.capFrom);
  const ids = [...new Set(caps.map((c) => c.pkt.id))];
  const cols: { p: TnPoint; label: string }[] = [
    { p: "laptop", label: "Laptop" },
    { p: "r1:gi0", label: "R1 Gi0/0" },
    { p: "r1:gi1", label: "R1 Gi0/1" },
    { p: "server", label: "Server" },
  ];
  const t0 = last.start;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-[12px]">
        <thead className="text-[11px] text-pv-text-faint">
          <tr>
            <th className="px-1.5 py-1">time</th>
            <th className="px-1.5 py-1">packet</th>
            {cols.map((c) => (
              <th key={c.p} className="px-1.5 py-1 text-center">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="pv-mono">
          {ids.slice(-40).map((id) => {
            const seen = caps.filter((c) => c.pkt.id === id);
            const first = seen[0];
            const toServer = first.pkt.dst === TN_ADDR.server;
            const order = toServer ? cols : [...cols].reverse();
            const lastSeen = order.reduce((acc, c, i) => (seen.some((x) => x.point === c.p) ? i : acc), -1);
            return (
              <tr key={id} className="border-t border-pv-border/50">
                <td className="px-1.5 py-0.5">{((first.t - t0) / 1000).toFixed(3)}</td>
                <td className={clsx("px-1.5 py-0.5", first.pkt.tcp?.flags.includes("RST") && "text-pv-danger", first.pkt.retx && "text-pv-warning")}>
                  {toServer ? "→" : "←"} {what(first)}
                  {first.pkt.tcp ? ` ${first.pkt.tcp.seq}` : ""}
                </td>
                {cols.map((c) => {
                  const hit = seen.find((x) => x.point === c.p);
                  const idx = order.findIndex((o) => o.p === c.p);
                  return (
                    <td key={c.p} className={clsx("px-1.5 py-0.5 text-center", hit ? (hit.note ? "text-pv-danger" : "text-pv-success") : idx > lastSeen ? "text-pv-danger/70" : "text-pv-text-faint")} title={hit?.note}>
                      {hit ? (hit.note ? "✕" : "✓") : idx > lastSeen && lastSeen < order.length - 1 ? "—" : ""}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1 text-[11.5px] text-pv-text-muted">✓ seen there · ✕ seen, then dropped there · — never got there. Seeing a SYN leave the Laptop doesn&apos;t prove the Server got it; seeing it at the Server doesn&apos;t prove the answer came back.</p>
    </div>
  );
}

export function SocketTable({ cfg, snap, host }: { cfg: TnCfg; snap: TnSnap; host: "laptop" | "server" }) {
  const rows = tnSockets(cfg, snap.tcbs, snap.udp, host);
  if (!rows.length) return <p className="text-[12.5px] text-pv-text-faint">No sockets: nothing is listening, nothing is connected.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[460px] text-left text-[12px]">
        <thead className="text-[11px] text-pv-text-faint">
          <tr>
            <th className="px-1.5 py-1">proto</th>
            <th className="px-1.5 py-1">state</th>
            <th className="px-1.5 py-1">local</th>
            <th className="px-1.5 py-1">peer</th>
            <th className="px-1.5 py-1">process</th>
          </tr>
        </thead>
        <tbody className="pv-mono">
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-pv-border/50">
              <td className="px-1.5 py-0.5">{r.proto}</td>
              <td className="px-1.5 py-0.5">{r.tcb ? <StatePill state={r.tcb.state} /> : <span className={r.state === "LISTEN" ? "text-pv-cyan-soft" : "text-pv-text-muted"}>{r.state}</span>}</td>
              <td className="px-1.5 py-0.5">{r.local}</td>
              <td className="px-1.5 py-0.5">{r.peer}</td>
              <td className="px-1.5 py-0.5">{r.proc ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Device windows
// ---------------------------------------------------------------------------------------------------------------
function cliApi(c: TcpDeskCtx, key?: string): TcpCliApi {
  return { view: c.view, act: c.act, ios: c.ios, setIos: c.setIos, junosEdit: c.junosEdit, setJunosEdit: c.setJunosEdit, cand: c.cand, setCand: c.setCand, history: key ? (c.consoles[key] ?? EMPTY_SESSION).history : undefined };
}
function Terminal({ c, dev }: { c: TcpDeskCtx; dev: TnDev }) {
  const router = dev === "r1";
  const os = router ? (c.vendor === "cisco" ? "ios" : "junos") : "linux";
  const key = `${dev}:${os}`;
  const api = cliApi(c, key);
  return (
    <ConsoleTerminal
      key={key}
      sets={router ? tcpR1Sets(api) : { cisco: dev === "laptop" ? tcpLaptopSet(api) : tcpServerSet(api) }}
      vendor={router ? c.vendor : "cisco"}
      setVendor={router ? c.setVendor : undefined}
      os={os}
      host={NAME[dev].toLowerCase() === "r1" ? "R1" : NAME[dev]}
      session={c.consoles[key] ?? EMPTY_SESSION}
      setSession={(u) => c.setConsoles((m) => ({ ...m, [key]: u(m[key] ?? EMPTY_SESSION) }))}
      notes={c.notes}
      setNotes={c.setNotes}
      className="h-[min(440px,58vh)]"
    />
  );
}
function LaptopUI({ c }: { c: TcpDeskCtx }) {
  const [tab, setTab] = useState<"status" | "sockets" | "term" | "cap">("status");
  const cfg = c.view.cfg.laptop;
  const snap = c.snap ?? { tcbs: c.view.tcbs, udp: c.view.udp };
  return (
    <>
      <Tabs
        tabs={[
          ["status", "Status"],
          ["sockets", "Sockets"],
          ["term", "Terminal"],
          ["cap", "Capture"],
        ]}
        cur={tab}
        set={setTab}
      />
      {tab === "status" && (
        <div className="space-y-2 p-3">
          <Kv k="Address" v={`${cfg.ip}/${cfg.prefix}`} />
          <Kv k="Default gateway" v={cfg.gw} />
          <Kv k="Client ports" v="picked by the OS per connection (ephemeral), 51001 and up in this lab" />
          <Kv k="TCP connections" v={snap.tcbs.filter((t) => t.host === "laptop").length} />
          <p className="text-[12.5px] text-pv-text-muted">The Laptop is a client: it listens on nothing. Each connection it opens gets its own source port, so two connections to the same Server port are still two different conversations.</p>
        </div>
      )}
      {tab === "sockets" && (
        <div className="space-y-2 p-3">
          <SocketTable cfg={c.view.cfg} snap={snap} host="laptop" />
          <p className="text-[11.5px] text-pv-text-faint">{c.snap ? "Live: as of the moment the topology is showing." : "As of now (ss -tan in the terminal shows the same)."}</p>
        </div>
      )}
      {tab === "term" && <Terminal c={c} dev="laptop" />}
      {tab === "cap" && <CaptureView s={c.view} points={["laptop"]} />}
    </>
  );
}
function ServerUI({ c }: { c: TcpDeskCtx }) {
  const [tab, setTab] = useState<"services" | "sockets" | "fw" | "term" | "cap">("services");
  const cfg = c.view.cfg;
  const s = cfg.server;
  const snap = c.snap ?? { tcbs: c.view.tcbs, udp: c.view.udp };
  const set = (f: (x: TnCfg["server"]) => void, text: string) => {
    const n = tnClone(cfg);
    f(n.server);
    c.act({ type: "cfg", cfg: n, text: `Server: ${text}` });
  };
  return (
    <>
      <Tabs
        tabs={[
          ["services", "Services"],
          ["sockets", "Sockets"],
          ["fw", "Firewall & routes"],
          ["term", "Terminal"],
          ["cap", "Capture"],
        ]}
        cur={tab}
        set={setTab}
      />
      {tab === "services" && (
        <div className="space-y-2 p-3">
          <p className="text-[12.5px] text-pv-text-muted">One address, {s.ip}, several applications — each reached through its own port. A stopped service&apos;s port has no listener: a SYN to it is answered with RST.</p>
          {s.services.map((x) => (
            <div key={x.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-pv-border px-2 py-1.5">
              <span className={clsx("h-2 w-2 rounded-full", x.running ? "bg-pv-success" : "bg-pv-danger")} />
              <span className="pv-mono text-[12.5px] font-semibold text-pv-text">{x.unit}</span>
              <span className="text-[12px] text-pv-text-muted">{x.what}</span>
              <span className="pv-mono text-[12px] text-pv-text-faint">
                {x.proto.toUpperCase()} {x.ports.join(", ")}
              </span>
              <span className="flex-1" />
              <button type="button" className={btn} onClick={() => set((y) => (y.services.find((z) => z.id === x.id)!.running = !x.running), `systemctl ${x.running ? "stop" : "start"} ${x.unit}`)}>
                {x.running ? "Stop" : "Start"}
              </button>
            </div>
          ))}
          {s.nc.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-pv-border px-2 py-1.5">
              <span className="h-2 w-2 rounded-full bg-pv-success" />
              <span className="pv-mono text-[12.5px] text-pv-text">nc -lk</span>
              <span className="pv-mono text-[12px] text-pv-text-faint">TCP {s.nc.join(", ")}</span>
              <span className="flex-1" />
              <button type="button" className={btn} onClick={() => set((y) => (y.nc = []), "pkill nc")}>
                Stop
              </button>
            </div>
          )}
        </div>
      )}
      {tab === "sockets" && (
        <div className="space-y-2 p-3">
          <SocketTable cfg={cfg} snap={snap} host="server" />
          <p className="text-[11.5px] text-pv-text-faint">{c.snap ? "Live: as of the moment the topology is showing." : "As of now (ss -tan / ss -tlnp in the terminal)."}</p>
        </div>
      )}
      {tab === "fw" && (
        <div className="space-y-2 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-pv-text-faint">iptables (first match wins; policy ACCEPT)</p>
          {s.ipt.length === 0 ? (
            <p className="text-[12.5px] text-pv-text-faint">No rules: everything is accepted.</p>
          ) : (
            s.ipt.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-pv-danger/40 px-2 py-1 pv-mono text-[12px]">
                <span className="text-pv-text">
                  {r.chain} {r.inIf ? `-i ${r.inIf} ` : ""}-p {r.proto}
                  {r.port ? ` --${r.chain === "INPUT" ? "dport" : "sport"} ${r.port}` : ""} -j {r.target === "REJECT-RST" ? "REJECT --reject-with tcp-reset" : r.target}
                </span>
                <span className="text-pv-text-faint">{r.pkts} packets</span>
                <span className="flex-1" />
                <button type="button" className={btn} onClick={() => set((y) => (y.ipt = y.ipt.filter((_, j) => j !== i)), `iptables: removed ${r.chain} ${r.proto} ${r.port ?? ""} ${r.target}`)}>
                  Delete
                </button>
              </div>
            ))
          )}
          <p className="pt-1 text-[11px] font-bold uppercase tracking-wide text-pv-text-faint">Routes</p>
          <Kv k="Default gateway" v={s.gw ?? "none — replies to other networks can't be sent"} tone={s.gw ? undefined : "bad"} />
          {!s.gw && (
            <button type="button" className={btn} onClick={() => set((y) => (y.gw = TN_ADDR.r1wan), "ip route add default via 10.20.20.1")}>
              Add default via {TN_ADDR.r1wan}
            </button>
          )}
        </div>
      )}
      {tab === "term" && <Terminal c={c} dev="server" />}
      {tab === "cap" && <CaptureView s={c.view} points={["server"]} />}
    </>
  );
}
function RouterUI({ c }: { c: TcpDeskCtx }) {
  const [tab, setTab] = useState<"ifs" | "acl" | "term" | "cap">("ifs");
  const cfg = c.view.cfg;
  const r = cfg.r1;
  const set = (f: (x: TnCfg["r1"]) => void, text: string) => {
    const n = tnClone(cfg);
    f(n.r1);
    c.act({ type: "cfg", cfg: n, text: `R1: ${text}` });
  };
  return (
    <>
      <Tabs
        tabs={[
          ["ifs", "Interfaces"],
          ["acl", "ACL"],
          ["term", "Console"],
          ["cap", "Capture"],
        ]}
        cur={tab}
        set={setTab}
      />
      {tab === "ifs" && (
        <div className="space-y-2 p-3">
          <p className="rounded-lg border border-pv-cyan/30 bg-pv-cyan/[0.05] px-2.5 py-1.5 text-[12.5px] text-pv-text-muted">
            R1 routes IP packets between the two networks. It reads the IP header, not the TCP state: there is <b className="text-pv-text">no socket table here</b>. A connection crossing R1 lives only in the Laptop and the Server.
          </p>
          {(["gi0", "gi1"] as const).map((i) => {
            const k = c.view.counters[i === "gi0" ? "r1:gi0" : "r1:gi1"];
            return (
              <div key={i} className="rounded-lg border border-pv-border p-2">
                <p className="text-[12.5px] font-semibold text-pv-text">
                  {c.vendor === "cisco" ? (i === "gi0" ? "Gi0/0" : "Gi0/1") : i === "gi0" ? "ge-0/0/0" : "ge-0/0/1"} · {r.ifs[i].ip}/24 · {i === "gi0" ? "toward the Laptop" : "toward the Server"}
                </p>
                <Kv k="State" v={r.ifs[i].up ? "up" : "administratively down"} tone={r.ifs[i].up ? undefined : "bad"} />
                <Kv k="Packets in / out" v={`${k.in} / ${k.out}`} />
                <Kv k="Input errors (CRC)" v={k.crc} tone={k.crc ? "bad" : undefined} />
                <Kv k="Dropped by the ACL" v={k.aclDrops} tone={k.aclDrops ? "warn" : undefined} />
                {i === "gi1" && r.ifs.gi1.badCable && (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="text-[12px] text-pv-danger">The cable on this port is damaged.</span>
                    <button type="button" className={btn} onClick={() => set((x) => (x.ifs.gi1.badCable = false), "replaced the damaged cable on Gi0/1")}>
                      Replace the cable
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {tab === "acl" && (
        <div className="space-y-2 p-3">
          <p className="text-[12.5px] text-pv-text-muted">
            ACL <b className="pv-mono text-pv-text">{r.acl.name}</b> {r.acl.appliedIn ? <>is applied inbound on {r.acl.appliedIn === "gi0" ? "Gi0/0 (from the Laptop)" : "Gi0/1 (from the Server)"}</> : "is not applied anywhere"}. A deny drops silently: no RST, no ICMP.
          </p>
          {r.acl.entries.map((e) => (
            <div key={e.seq} className={clsx("flex flex-wrap items-center gap-2 rounded-lg border px-2 py-1 pv-mono text-[12px]", e.action === "deny" ? "border-pv-danger/50" : "border-pv-border")}>
              <span className="text-pv-text">{iosAclLine(e)}</span>
              <span className="text-pv-text-faint">{e.hits} matches</span>
              <span className="flex-1" />
              {e.action === "deny" && (
                <button type="button" className={btn} onClick={() => set((x) => (x.acl.entries = x.acl.entries.filter((y) => y.seq !== e.seq)), `ACL ${r.acl.name}: no ${e.seq}`)}>
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {tab === "term" && <Terminal c={c} dev="r1" />}
      {tab === "cap" && <CaptureView s={c.view} points={["r1:gi0", "r1:gi1"]} />}
    </>
  );
}

function Win({ w, c, narrow, focused, onFocus, onMove, onMin, onClose }: { w: TcpWin; c: TcpDeskCtx; narrow: boolean; focused: boolean; onFocus: () => void; onMove: (x: number, y: number) => void; onMin: () => void; onClose: () => void }) {
  const drag = useRef<{ dx: number; dy: number } | undefined>(undefined);
  const cfg = c.view.cfg;
  const sub = w.id === "laptop" ? `Linux client · ${cfg.laptop.ip}` : w.id === "server" ? `Linux server · ${cfg.server.ip}` : `Router · ${c.vendor === "cisco" ? "Cisco IOS" : "Junos"} view`;
  const tone = w.id === "r1" ? "#22d3ee" : "#34d399";
  return (
    <section
      role="dialog"
      aria-label={`${NAME[w.id]} window`}
      onPointerDown={onFocus}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onMin();
        }
      }}
      className={clsx("flex flex-col overflow-hidden border bg-pv-bg shadow-2xl", narrow ? "fixed inset-0 rounded-none" : "fixed rounded-xl", focused ? "border-pv-cyan/60" : "border-pv-border", w.minimized && "hidden")}
      style={narrow ? { zIndex: 100 + w.z } : { left: w.x, top: w.y, width: "min(780px, calc(100vw - 32px))", height: "min(620px, calc(100vh - 96px))", zIndex: 100 + w.z, resize: "both" }}
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
          {w.id === "laptop" ? "💻" : w.id === "server" ? "🗄" : "R"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-bold text-pv-text">{NAME[w.id]}</p>
          <p className="truncate text-[11px] text-pv-text-faint">{sub}</p>
        </div>
        {!narrow && (
          <button type="button" onClick={onMin} aria-label={`Minimize ${NAME[w.id]}`} className="rounded-md px-2 text-[14px] text-pv-text-faint hover:bg-white/10 hover:text-pv-text">
            –
          </button>
        )}
        <button type="button" onClick={onClose} aria-label={`Close ${NAME[w.id]}`} className="rounded-md px-2 text-[14px] text-pv-text-faint hover:bg-pv-danger/20 hover:text-pv-text">
          ✕
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{w.id === "laptop" ? <LaptopUI c={c} /> : w.id === "server" ? <ServerUI c={c} /> : <RouterUI c={c} />}</div>
    </section>
  );
}

export function TcpDesk({ windows, setWindows, focus, setFocus, ctx }: { windows: TcpWin[]; setWindows: (u: (w: TcpWin[]) => TcpWin[]) => void; focus?: TnDev; setFocus: (n: TnDev | undefined) => void; ctx: TcpDeskCtx }) {
  const narrow = useNarrow();
  if (typeof document === "undefined" || !windows.length) return null;
  const top = Math.max(0, ...windows.map((w) => w.z));
  const raise = (id: TnDev) => {
    setFocus(id);
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, z: top + 1, minimized: false } : w)));
  };
  const minimize = (id: TnDev) => (setWindows((ws) => ws.map((v) => (v.id === id ? { ...v, minimized: true } : v))), setFocus(undefined));
  return createPortal(
    <>
      {windows.map((w) => (
        <Win key={w.id} w={w} c={ctx} narrow={narrow} focused={focus === w.id} onFocus={() => focus !== w.id && raise(w.id)} onMove={(x, y) => setWindows((ws) => ws.map((v) => (v.id === w.id ? { ...v, x, y } : v)))} onMin={() => minimize(w.id)} onClose={() => (setWindows((ws) => ws.filter((v) => v.id !== w.id)), setFocus(undefined))} />
      ))}
      <nav aria-label="Open devices" className="fixed bottom-3 left-1/2 z-[99] flex max-w-[calc(100vw-24px)] -translate-x-1/2 gap-1 overflow-x-auto rounded-full border border-pv-border bg-pv-bg/95 px-2 py-1 shadow-xl">
        {windows.map((w) => (
          <button key={w.id} type="button" onClick={() => (w.minimized || focus !== w.id ? raise(w.id) : minimize(w.id))} className={clsx("flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold", !w.minimized && focus === w.id ? "bg-pv-cyan/20 text-pv-text" : "text-pv-text-muted hover:text-pv-text")}>
            {NAME[w.id]}
            {w.minimized && <span className="text-[10px] text-pv-text-faint">(min)</span>}
          </button>
        ))}
      </nav>
    </>,
    document.body,
  );
}
export function openTcpWindow(ws: TcpWin[], id: TnDev): TcpWin[] {
  const top = Math.max(0, ...ws.map((w) => w.z));
  if (ws.some((w) => w.id === id)) return ws.map((w) => (w.id === id ? { ...w, minimized: false, z: top + 1 } : w));
  const n = ws.length;
  const x = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerWidth - 800, 40 + n * 36));
  const y = typeof window === "undefined" ? 80 : Math.max(16, Math.min(window.innerHeight - 640, 90 + n * 30));
  return [...ws, { id, minimized: false, x, y, z: top + 1 }];
}
export { TN_POINTS };
