"use client";

import { useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { IC_ADDR } from "@/lib/sim-engine/scenarios/icmpDiagnostics";
import { IC_FILES, IC_POINTS, icExplain, icFollow, icPointLabel, type IcAction, type IcDev, type IcPmtuMode, type IcProbe, type IcRun, type IcState } from "@/lib/sim-engine/scenarios/icmpNet";
import { curlText, explainProbe, iosPingText, iosTraceText, linuxPingText, linuxTraceText } from "./icCli";
import { KIND_COLOR, pktLabel } from "./IcTopology";

/**
 * Pieces shared by the Learn levels and the engineering desk: the probe composer (every control explained, the
 * equivalent HOST-A command shown), the result reader (the tool's own output, then who answered, what it means and
 * what it proves), Follow-the-probe (which interfaces saw the request and the response), the packet-size arithmetic,
 * and the "what does this prove?" claims.
 */

export const TARGETS: { ip: string; label: string }[] = [
  { ip: IC_ADDR["HOST-B"], label: "HOST-B" },
  { ip: IC_ADDR["R2:LAN"], label: "R2 LAN side" },
  { ip: IC_ADDR["R2:TRANSIT"], label: "R2 transit side" },
  { ip: IC_ADDR["R1:LAN"], label: "R1" },
  { ip: "198.51.100.99", label: "unused address on LAN-B" },
  { ip: "10.20.30.40", label: "a network nobody routes" },
];
/** The same targets seen from HOST-B: the far host and the routers in the order a probe from there meets them. */
const TARGETS_FROM_B: { ip: string; label: string }[] = [
  { ip: IC_ADDR["HOST-A"], label: "HOST-A" },
  { ip: IC_ADDR["R1:LAN"], label: "R1 LAN side" },
  { ip: IC_ADDR["R1:TRANSIT"], label: "R1 transit side" },
  { ip: IC_ADDR["R2:LAN"], label: "R2" },
  { ip: "192.0.2.99", label: "unused address on LAN-A" },
  { ip: "10.20.30.40", label: "a network nobody routes" },
];
const targetsFor = (dev: IcDev) => (dev === "HOST-B" ? TARGETS_FROM_B : TARGETS);
export const pathMtu = (s: IcState) => Math.min(s.cfg.R1.ifs.ge1.mtu, s.cfg.R2.ifs.ge1.mtu, s.cfg.R1.ifs.ge0.mtu, s.cfg.R2.ifs.ge0.mtu, s.cfg["HOST-A"].mtu, s.cfg["HOST-B"].mtu);
export const commandOf = (a: IcAction): string => {
  if (a.type === "ping") return `ping -c ${a.count ?? 4}${a.data !== undefined && a.data !== 56 ? ` -s ${a.data}` : ""}${a.mode && a.mode !== "want" ? ` -M ${a.mode}` : ""}${a.ttl && a.ttl !== 64 ? ` -t ${a.ttl}` : ""} ${a.dst}`;
  if (a.type === "trace") return `traceroute${a.icmp ? " -I" : ""} ${a.dst}`;
  if (a.type === "curl") return `curl -o /dev/null http://${IC_ADDR["HOST-B"]}${IC_FILES[a.file].path}`;
  return "";
};
export const runText = (r: IcRun) => (r.tool === "curl" ? curlText(r) : r.dev === "R1" || r.dev === "R2" ? (r.tool === "ping" ? iosPingText(r, (r.args.data ?? 72) + 28, r.args.mode === "do") : iosTraceText(r)) : r.tool === "ping" ? linuxPingText(r) : linuxTraceText(r));

/** ICMP data + 8 + 20 = the IP packet, against the smallest MTU on the path. */
export function SizeMath({ data, mtu, onData }: { data: number; mtu: number; onData?: (n: number) => void }) {
  const total = data + 28;
  const over = total - mtu;
  return (
    <div className="rounded-2xl border border-pv-border bg-pv-bg-elevated/30 p-3">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-pv-text-faint">Packet size</p>
      {onData && (
        <div className="mt-1 flex items-center gap-2">
          <input type="range" min={0} max={1572} value={data} onChange={(e) => onData(+e.target.value)} aria-label="ICMP data bytes" className="flex-1 accent-[#22d3ee]" />
          <input type="number" min={0} max={1572} value={data} onChange={(e) => onData(Math.max(0, Math.min(1572, +e.target.value || 0)))} aria-label="ICMP data bytes (number)" className="h-8 w-20 rounded-lg border border-pv-border bg-pv-bg px-2 pv-mono text-[13px] text-pv-text" />
        </div>
      )}
      <div className="mt-1.5 grid grid-cols-[auto_1fr] items-baseline gap-x-3 pv-mono text-[13.5px]">
        <span className="text-pv-text-muted">ICMP data</span>
        <span className="text-right text-pv-text">{data}</span>
        <span className="text-pv-text-muted">+ ICMP header</span>
        <span className="text-right text-pv-text">8</span>
        <span className="text-pv-text-muted">+ IPv4 header</span>
        <span className="text-right text-pv-text">20</span>
        <span className="border-t border-pv-border pt-0.5 font-bold text-pv-text">= IP packet</span>
        <span className="border-t border-pv-border pt-0.5 text-right font-bold text-pv-text">{total}</span>
        <span className="text-pv-text-muted">smallest MTU on the path</span>
        <span className="text-right text-pv-warning">{mtu}</span>
      </div>
      <p className={clsx("mt-1.5 text-[13px] font-semibold", over > 0 ? "text-pv-danger" : "text-pv-success")}>{over > 0 ? `${over} byte${over > 1 ? "s" : ""} too big: with DF it is refused (3/4); without DF it is fragmented.` : over === 0 ? "Exactly fits — the largest packet this path carries whole." : `Fits, with ${-over} byte${over < -1 ? "s" : ""} to spare.`}</p>
      <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-pv-bg">
        <div className={clsx("h-full rounded-full", over > 0 ? "bg-pv-danger" : "bg-pv-success")} style={{ width: `${Math.min(100, (total / 1600) * 100)}%` }} />
      </div>
      <div className="relative h-4 text-[10.5px] text-pv-text-faint">
        <span className="absolute -translate-x-1/2 text-pv-warning" style={{ left: `${(mtu / 1600) * 100}%` }}>
          ▲ {mtu}
        </span>
      </div>
    </div>
  );
}

/** Who saw the request and the response — the interfaces in path order. */
export function Follow({ probe }: { probe: IcProbe }) {
  const rows = icFollow(probe);
  const lastReq = [...rows].reverse().find((r) => r.sawRequest);
  return (
    <div className="rounded-2xl border border-pv-border bg-pv-bg-elevated/30 p-3">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-pv-text-faint">Follow the probe</p>
      <div className="mt-1 overflow-x-auto">
        <table className="w-full min-w-[420px] text-[12.5px]">
          <thead className="text-[11px] text-pv-text-faint">
            <tr>
              <th className="py-0.5 text-left">interface</th>
              <th className="py-0.5">request seen</th>
              <th className="py-0.5">response seen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.point} className="border-t border-pv-border/50">
                <td className="py-0.5 pv-mono text-pv-text">{icPointLabel(r.point)}</td>
                <td className={clsx("py-0.5 text-center", r.sawRequest ? "text-pv-success" : "text-pv-text-faint")}>{r.sawRequest ? "✓" : "—"}</td>
                <td className={clsx("py-0.5 text-center", r.sawResponse ? "text-pv-success" : "text-pv-text-faint")}>{r.sawResponse ? "✓" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[12px] text-pv-text-muted">{lastReq ? `The request got as far as ${icPointLabel(lastReq.point)}.` : "The request never left HOST-A."} {rows[0].sawResponse ? "A response made it back to HOST-A." : "Nothing came back to HOST-A."}</p>
    </div>
  );
}

/** The tool's own output, then what it means. */
export function ResultView({ s, run, follow = true }: { s: IcState; run: IcRun; follow?: boolean }) {
  const distinct: IcProbe[] = [];
  const probes = run.tool === "traceroute" ? run.hops!.map((h) => h.find((p) => p.answer) ?? h[0]) : run.probes;
  for (const p of probes) if (!distinct.some((d) => (d.answer?.kind ?? d.localError ?? "-") === (p.answer?.kind ?? p.localError ?? "-") && d.answerFrom === p.answerFrom)) distinct.push(p);
  const last = run.tool === "curl" ? run.probes[run.probes.length - 1] : probes[probes.length - 1];
  return (
    <div className="space-y-2">
      <pre className="max-h-64 overflow-auto whitespace-pre rounded-xl border border-pv-border bg-[#05080f] p-2.5 pv-mono text-[12px] leading-snug text-pv-text">
        <span className="text-pv-success">{run.dev === "HOST-A" ? "admin@host-a:~$ " : `${run.dev}# `}</span>
        {run.tool === "curl" ? commandOf({ type: "curl", file: run.args.file ?? "small" }) : run.dev === "HOST-A" || run.dev === "HOST-B" ? commandOf(run.tool === "ping" ? { type: "ping", dev: run.dev, dst: run.dst, count: run.probes.length, data: run.args.data, mode: run.args.mode, ttl: run.args.ttl } : { type: "trace", dev: run.dev, dst: run.dst, icmp: run.args.icmp }) : `${run.tool} ${run.dst}`}
        {"\n"}
        {runText(run)}
      </pre>
      {run.tool === "curl" ? (
        <Reading title={run.curl!.ok ? "Download complete" : run.curl!.reason === "no-route" ? "Connection refused by an ICMP error" : "Silence — the transfer hangs"} ok={run.curl!.ok} meaning={explainProbe(run) ?? ""} conclude={run.curl!.ok ? "TCP worked both ways for full-size packets." : "No error reached HOST-A. Look at what the server (HOST-B) received, and what the routers sent it."} />
      ) : (
        distinct.slice(0, 3).map((p, i) => {
          const e = icExplain(s.cfg, p);
          return <Reading key={i} title={e.title} ok={e.ok} meaning={e.meaning} conclude={e.conclude} kind={p.answer ? pktLabel(p.answer) : undefined} color={p.answer ? KIND_COLOR[p.answer.kind ?? p.answer.proto] : undefined} />;
        })
      )}
      {follow && last && <Follow probe={last} />}
    </div>
  );
}
function Reading({ title, ok, meaning, conclude, kind, color }: { title: string; ok: boolean; meaning: string; conclude: string; kind?: string; color?: string }) {
  return (
    <div className={clsx("rounded-2xl border p-3", ok ? "border-pv-success/45 bg-pv-success/[0.06]" : "border-pv-warning/45 bg-pv-warning/[0.06]")}>
      <p className="flex flex-wrap items-center gap-2 text-[14.5px] font-semibold text-pv-text">
        {kind && <span className="rounded-full px-2 py-0.5 pv-mono text-[11.5px] font-bold text-[#03131a]" style={{ background: color }}>{kind}</span>}
        {title}
      </p>
      <p className="mt-1 text-[13.5px] leading-snug text-pv-text-muted">{meaning}</p>
      <p className="mt-1 text-[13.5px] leading-snug text-pv-text">
        <b>So:</b> {conclude}
      </p>
    </div>
  );
}

const Row = ({ label, why, children }: { label: string; why: string; children: ReactNode }) => (
  <div className="grid gap-x-3 gap-y-0.5 sm:grid-cols-[8.5rem_1fr]">
    <span className="text-[12.5px] font-semibold text-pv-text">{label}</span>
    <div>
      {children}
      <p className="text-[11.5px] leading-snug text-pv-text-faint">{why}</p>
    </div>
  </div>
);

/** The diagnostic controls, each with the question it answers. */
export function ProbeComposer({ s, act, onRun, from = "HOST-A", lockTool, devices = ["HOST-A", "HOST-B"] }: { s: IcState; act: (a: IcAction) => IcState; onRun: (r: IcRun) => void; from?: IcDev; lockTool?: "ping" | "traceroute" | "curl"; devices?: IcDev[] }) {
  const [tool, setTool] = useState<"ping" | "traceroute" | "curl">(lockTool ?? "ping");
  const [dev, setDev] = useState<IcDev>(from);
  const [dst, setDst] = useState<string>(targetsFor(from)[0].ip);
  const [custom, setCustom] = useState("");
  const [data, setData] = useState(56);
  const [mode, setMode] = useState<IcPmtuMode>("want");
  const [ttl, setTtl] = useState(64);
  const [count, setCount] = useState(4);
  const [icmp, setIcmp] = useState(false);
  const [file, setFile] = useState<"small" | "big">("small");
  const target = custom.trim() || dst;
  // A host probing its own address never leaves it (loopback): nothing to watch on the network.
  const self = tool !== "curl" && (dev === "HOST-A" || dev === "HOST-B") && target === IC_ADDR[dev];
  const action: IcAction = tool === "ping" ? { type: "ping", dev, dst: target, count, data, mode, ttl } : tool === "traceroute" ? { type: "trace", dev, dst: target, icmp } : { type: "curl", file };
  const go = () => {
    const n = act(action);
    if (n.last && n.seq !== s.seq) onRun(n.last);
  };
  const chip = (on: boolean, label: string, onClick: () => void, key: string) => (
    <button key={key} type="button" aria-pressed={on} onClick={onClick} className={clsx("rounded-full border px-2.5 py-0.5 text-[12.5px] font-semibold", on ? "border-pv-cyan bg-pv-cyan/15 text-pv-text" : "border-pv-border text-pv-text-muted hover:text-pv-text")}>
      {label}
    </button>
  );
  return (
    <div className="space-y-2.5 rounded-2xl border border-pv-cyan/35 bg-pv-cyan/[0.04] p-3">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-pv-text-faint">Generate a probe</p>
      {!lockTool && (
        <Row label="Tool" why={tool === "ping" ? "Is it reachable — and does the reply come back?" : tool === "traceroute" ? "Which routers are on the way, and where does it stop?" : "Does a real application (TCP, full-size packets) work?"}>
          <div className="flex flex-wrap gap-1">{(["ping", "traceroute", "curl"] as const).map((t) => chip(tool === t, t, () => setTool(t), t))}</div>
        </Row>
      )}
      {tool !== "curl" && devices.length > 1 && (
        <Row label="From" why="Where the probe starts. Replies and errors come back to this device.">
          <div className="flex flex-wrap gap-1">{devices.map((d) => chip(dev === d, d, () => (setDev(d), setDst(targetsFor(d)[0].ip)), d))}</div>
        </Row>
      )}
      {tool !== "curl" ? (
        <Row label="Target" why="What you're testing reachability to. A router's own address tests the path up to it.">
          <div className="flex flex-wrap gap-1">{targetsFor(dev).map((t) => chip(!custom && dst === t.ip, t.label, () => (setDst(t.ip), setCustom("")), t.ip))}</div>
          <input value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="or type an address" aria-label="Target address" className="mt-1 h-8 w-44 rounded-lg border border-pv-border bg-pv-bg px-2 pv-mono text-[13px] text-pv-text" />
        </Row>
      ) : (
        <Row label="File" why="A tiny page fits in one small packet; the big file needs full-size (1500-byte) packets with DF, as TCP sends them.">
          <div className="flex flex-wrap gap-1">{(["small", "big"] as const).map((f) => chip(file === f, f === "small" ? "index.html (900 B)" : "big.iso (50 MB)", () => setFile(f), f))}</div>
        </Row>
      )}
      {tool === "ping" && (
        <>
          <Row label={`Data (-s ${data})`} why={`The IP packet will be ${data} + 8 + 20 = ${data + 28} bytes. Size tests whether big packets fit the path.`}>
            <div className="flex items-center gap-2">
              <input type="range" min={0} max={1572} value={data} onChange={(e) => setData(+e.target.value)} aria-label="Data bytes" className="flex-1 accent-[#22d3ee]" />
              <input type="number" min={0} max={1572} value={data} onChange={(e) => setData(Math.max(0, Math.min(1572, +e.target.value || 0)))} aria-label="Data bytes number" className="h-8 w-20 rounded-lg border border-pv-border bg-pv-bg px-2 pv-mono text-[13px] text-pv-text" />
            </div>
          </Row>
          <Row label="DF (-M)" why={mode === "do" ? "DF set, never fragment: a too-big packet is refused and a router should send 3/4." : mode === "dont" ? "DF clear: routers may fragment a too-big packet." : "Linux default: DF set, but the host fragments itself above a path MTU it has learnt."}>
            <div className="flex flex-wrap gap-1">{(["want", "do", "dont"] as const).map((m) => chip(mode === m, m === "want" ? "want (default)" : m === "do" ? "do — DF, no fragmenting" : "dont — no DF", () => setMode(m), m))}</div>
          </Row>
          <Row label={`Starting TTL (-t ${ttl})`} why="Each router subtracts 1. Small values make the probe expire on the way — that's how you find hops.">
            <div className="flex flex-wrap gap-1">{[1, 2, 3, 64].map((t) => chip(ttl === t, String(t), () => setTtl(t), String(t)))}</div>
          </Row>
          <Row label={`Count (-c ${count})`} why="More probes reveal intermittent problems; four identical answers prove the result is stable.">
            <div className="flex flex-wrap gap-1">{[1, 4, 10].map((c) => chip(count === c, String(c), () => setCount(c), String(c)))}</div>
          </Row>
        </>
      )}
      {tool === "traceroute" && (
        <Row label="Probes" why={icmp ? "ICMP Echo probes (traceroute -I): the destination answers with an Echo Reply — unless it filters ping." : "UDP probes (Linux default): the destination answers with ICMP 3/3 Port Unreachable."}>
          <div className="flex flex-wrap gap-1">
            {chip(!icmp, "UDP (default)", () => setIcmp(false), "u")}
            {chip(icmp, "ICMP (-I)", () => setIcmp(true), "i")}
          </div>
        </Row>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={go} disabled={self} className="rounded-full bg-pv-cyan px-4 py-1.5 text-[14px] font-semibold text-[#03131a] disabled:cursor-not-allowed disabled:opacity-40">
          Run it
        </button>
        {self && <span className="text-[12px] text-pv-warning">{target} is {dev}&apos;s own address: it answers itself over loopback and nothing crosses the network. Pick another target.</span>}
        <code className="rounded-md bg-[#05080f] px-2 py-1 pv-mono text-[12px] text-pv-text-muted">
          {tool === "curl" ? "" : dev === "HOST-A" || dev === "HOST-B" ? `${dev.toLowerCase()}$ ` : `${dev}# `}
          {commandOf(action)}
        </code>
      </div>
    </div>
  );
}

/** "Does this result prove …?" — claims to sort into proven / not proven, each with the reason. */
export function Claims({ title, items }: { title: string; items: { claim: string; proven: boolean; why: string }[] }) {
  const [pick, setPick] = useState<Record<number, boolean>>({});
  return (
    <div className="space-y-1.5 rounded-2xl border border-pv-violet/40 bg-pv-violet/[0.06] p-3">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-pv-violet">{title}</p>
      {items.map((it, i) => (
        <div key={i} className="rounded-lg border border-pv-border/60 px-2.5 py-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex-1 text-[13.5px] text-pv-text">{it.claim}</span>
            {[true, false].map((v) => (
              <button key={String(v)} type="button" aria-pressed={pick[i] === v} onClick={() => setPick((m) => ({ ...m, [i]: v }))} className={clsx("rounded-full border px-2.5 py-0.5 text-[12px] font-semibold", pick[i] === v ? (v === it.proven ? "border-pv-success bg-pv-success/15 text-pv-success" : "border-pv-danger bg-pv-danger/15 text-pv-danger") : "border-pv-border text-pv-text-muted")}>
                {v ? "proven" : "not proven"}
              </button>
            ))}
          </div>
          {pick[i] !== undefined && <p className={clsx("mt-1 text-[12.5px] leading-snug", pick[i] === it.proven ? "text-pv-text-muted" : "text-pv-text")}>{pick[i] === it.proven ? "✓ " : "Not quite: "}{it.why}</p>}
        </div>
      ))}
    </div>
  );
}

export const POINTS_ORDER = IC_POINTS;
