"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { ssCheck, ssDevices, ssNetOf, ssParent, ssShortIf, type SsFrame, type SsPing, type SsState } from "@/lib/sim-engine/scenarios/subnetStudio";
import { alpha } from "./SubnetKit";

/**
 * THE NETWORK — the studio's topology drawn from the model: R1, one switch per LAN with its devices, the far router
 * on each link. Every label is the live configuration (interface address/prefix, each device's address), and each
 * LAN carries its block from the plan in the same color as the address board, so a block on the board and a LAN in
 * the topology are visibly the same thing.
 *
 * Packets: a ping's frames (ARP request floods, ARP replies, echo request/reply, R1's new frame, ICMP errors, drops)
 * are produced by the model's own walk (ssPing); this component only moves dots along the node paths it was given.
 */

export interface TopoProps {
  ss: SsState;
  color: (id: string) => string;
  focus?: string;
  setFocus?: (wire: string | undefined) => void;
  onOpen?: (dev: string) => void;
  ping?: SsPing;
  /** Changes when a new ping should start playing. */
  pingKey?: string | number;
  narrow?: boolean;
  /** Fill the parent's height (the Engineer desk): the drawing scales to the space it is given. */
  fill?: boolean;
}
interface P {
  x: number;
  y: number;
}

function layout(ss: SsState, narrow: boolean) {
  const pos: Record<string, P> = {};
  const lans = [...ss.needs].filter((n) => n.kind === "lan").sort((a, b) => a.iface - b.iface);
  const links = [...ss.needs].filter((n) => n.kind === "link").sort((a, b) => a.iface - b.iface);
  const devs = ssDevices(ss.needs);
  const regions: { wire: string; x: number; y: number; w: number; h: number }[] = [];
  /** Where each R1 interface label goes (beside the switch, or under the far router). */
  const ifLabel: Record<string, P> = {};
  if (!narrow) {
    const W = 900;
    const top = links.length ? 130 : 30;
    const rows = Math.ceil(lans.length / 2);
    const rowH = 200;
    const H = top + rows * rowH + 10;
    pos.r1 = { x: W / 2, y: top + (rows * rowH) / 2 - 4 };
    links.forEach((n, i) => {
      const x = W / 2 + (i - (links.length - 1) / 2) * 230;
      const d = devs.find((v) => v.wire === n.id)!;
      pos[d.id] = { x, y: 40 };
      ifLabel[n.id] = { x, y: 82 };
    });
    lans.forEach((n, i) => {
      const left = i % 2 === 0;
      const row = Math.floor(i / 2);
      const ry = top + row * rowH + 6;
      const rh = rowH - 12;
      const rx = left ? 8 : W / 2 + 62;
      const rw = W / 2 - 70;
      regions.push({ wire: n.id, x: rx, y: ry, w: rw, h: rh });
      const areaTop = ry + 54;
      const areaH = rh - 60;
      const cy = areaTop + areaH / 2;
      const sx = left ? rx + rw - 70 : rx + 70;
      pos[`sw:${n.id}`] = { x: sx, y: cy - 10 };
      ifLabel[n.id] = { x: sx, y: cy + 22 };
      const ds = devs.filter((d) => d.wire === n.id);
      ds.forEach((d, k) => {
        pos[d.id] = { x: left ? rx + 92 : rx + rw - 92, y: cy + (k - (ds.length - 1) / 2) * 58 };
      });
    });
    return { pos, regions, ifLabel, W, H };
  }
  const W = 360;
  pos.r1 = { x: 74, y: 40 };
  links.forEach((n, i) => {
    const d = devs.find((v) => v.wire === n.id)!;
    pos[d.id] = { x: 268, y: 40 + i * 56 };
    ifLabel[n.id] = { x: 200, y: 74 + i * 56 };
  });
  let y = 64 + Math.max(1, links.length) * 50;
  lans.forEach((n) => {
    const ds = devs.filter((d) => d.wire === n.id);
    const h = Math.max(118, 48 + ds.length * 46);
    regions.push({ wire: n.id, x: 4, y, w: W - 8, h });
    pos[`sw:${n.id}`] = { x: 60, y: y + 64 };
    ifLabel[n.id] = { x: 82, y: y + 94 };
    ds.forEach((d, k) => {
      pos[d.id] = { x: 270, y: y + 64 + (k - (ds.length - 1) / 2) * 46 };
    });
    y += h + 8;
  });
  return { pos, regions, ifLabel, W, H: y };
}

const KIND_COLOR: Record<SsFrame["kind"], string> = { "arp-req": "#fbbf24", "arp-rep": "#34d399", icmp: "#22d3ee", "icmp-err": "#f87171", drop: "#f87171" };
const KIND_LABEL: Record<SsFrame["kind"], string> = { "arp-req": "ARP request (broadcast)", "arp-rep": "ARP reply", icmp: "ICMP echo", "icmp-err": "ICMP error", drop: "dropped" };
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const STEP_MS = 1100;

export function SubnetTopology({ ss, color, focus, setFocus, onOpen, ping, pingKey, narrow = false, fill = false }: TopoProps) {
  const { pos, regions, ifLabel, W, H } = layout(ss, narrow);
  const parent = ssParent(ss);
  const devs = ssDevices(ss.needs);
  const frames = ping?.frames ?? [];
  const [idx, setIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [seenKey, setSeenKey] = useState(pingKey);
  if (seenKey !== pingKey) {
    setSeenKey(pingKey);
    setIdx(frames.length ? (reduced() ? frames.length - 1 : 0) : -1);
    setPlaying(frames.length > 0 && !reduced());
  }
  useEffect(() => {
    if (!playing) return;
    if (idx >= frames.length - 1) {
      const t = window.setTimeout(() => setPlaying(false), STEP_MS);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setIdx((i) => i + 1), STEP_MS);
    return () => window.clearTimeout(t);
  }, [playing, idx, frames.length]);
  const frame = idx >= 0 ? frames[idx] : undefined;
  const linkActive = (a: string, b: string) => !!frame && frame.paths.some((p) => p.some((n, i) => i > 0 && ((p[i - 1] === a && n === b) || (p[i - 1] === b && n === a))));
  const fs = narrow ? 11 : 14;

  const line = (a: string, b: string, key: string, c: string, wire?: string) => {
    const pa = pos[a];
    const pb = pos[b];
    if (!pa || !pb) return null;
    const on = linkActive(a, b);
    return <line key={key} data-wire={wire} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke={on ? KIND_COLOR[frame!.kind] : c} strokeWidth={on ? 3.5 : 2} strokeOpacity={on ? 1 : 0.55} />;
  };
  const node = (id: string, label: string, sub: string, tone: string, kind: "router" | "switch" | "host", w = 112, wire?: string) => {
    const p = pos[id];
    if (!p) return null;
    const h = kind === "switch" ? 26 : 38;
    const dropHere = frame?.kind === "drop" && frame.paths.some((x) => x[0] === id);
    const clickable = kind !== "switch" && !!onOpen;
    return (
      <g key={id} data-wire={wire} transform={`translate(${p.x - w / 2},${p.y - h / 2})`} onClick={clickable ? () => onOpen!(id) : undefined} onKeyDown={clickable ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen!(id)) : undefined} role={clickable ? "button" : undefined} tabIndex={clickable ? 0 : undefined} aria-label={clickable ? `Open ${label}: ${sub}` : undefined} className={clsx(clickable && "cursor-pointer outline-none [&:focus-visible>rect]:stroke-white")}>
        <rect width={w} height={h} rx={kind === "router" ? 19 : 7} fill="#0b1220" stroke={dropHere ? "#f87171" : tone} strokeWidth={dropHere ? 3 : 1.6} />
        <text x={w / 2} y={kind === "switch" ? 17 : 16} textAnchor="middle" fill="#e8edf9" fontSize={fs} fontWeight={700}>
          {label}
        </text>
        {kind !== "switch" && (
          <text x={w / 2} y={30} textAnchor="middle" fill={sub.startsWith("no ") ? "#f87171" : "#94a3b8"} fontSize={fs - 1.5} fontFamily="ui-monospace, monospace">
            {sub}
          </text>
        )}
        {dropHere && (
          <text x={w - 4} y={-4} textAnchor="end" fill="#f87171" fontSize={16} fontWeight={800}>
            ✕
          </text>
        )}
      </g>
    );
  };

  return (
    <figure className={fill ? "flex h-full min-h-0 w-full flex-col" : "w-full"} aria-label="Network topology">
      <div className={fill ? "min-h-0 flex-1" : undefined}>
      <svg viewBox={`0 0 ${W} ${H}`} className={clsx("w-full select-none", fill ? "h-full" : "h-auto")}
        // One hover target for the whole drawing: the LAN is whatever LAN the element under the pointer belongs to
        // (its box, its switch, its devices, its interface label), so moving between them never "leaves" the LAN.
        // Touch keeps tap-to-focus (the region's onClick) and doesn't clear on lift.
        onPointerOver={(e) => setFocus?.((e.target as Element).closest("[data-wire]")?.getAttribute("data-wire") ?? undefined)}
        onPointerLeave={(e) => e.pointerType !== "touch" && setFocus?.(undefined)}
        role="group" aria-label={`Topology: R1 and ${ss.needs.length} networks`}>
        {regions.map((r) => {
          const c = color(r.wire);
          const n = ss.needs.find((x) => x.id === r.wire)!;
          const row = ssCheck(parent, ss.needs, ss.rows, r.wire);
          const on = focus === r.wire;
          return (
            <g key={r.wire} data-wire={r.wire} onClick={() => setFocus?.(r.wire)}>
              <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={12} fill={alpha(c, on ? 0.14 : 0.06)} stroke={c} strokeOpacity={on ? 0.95 : 0.4} strokeWidth={on ? 2.5 : 1.2} strokeDasharray={row ? undefined : "5 4"} />
              <text x={r.x + 10} y={r.y + 19} fill={c} fontSize={fs + 0.5} fontWeight={800}>
                {n.id} <tspan fill="#94a3b8" fontWeight={500}>· needs {n.hosts}</tspan>
              </text>
              <text x={r.x + 10} y={r.y + 37} fill={row ? (row.valid ? "#cbd5e1" : "#fca5a5") : "#64748b"} fontSize={fs - 1} fontFamily="ui-monospace, monospace">
                {row ? `${row.real}/${row.prefix}${row.valid ? "" : " ✕"}` : "no block yet"}
              </text>
            </g>
          );
        })}
        {ss.needs.map((n) => {
          const ds = devs.filter((d) => d.wire === n.id);
          const c = color(n.id);
          if (n.kind === "link") return ds.map((d) => line("r1", d.id, `l-${d.id}`, c, n.id));
          return [line("r1", `sw:${n.id}`, `l-${n.id}`, c, n.id), ...ds.map((d) => line(`sw:${n.id}`, d.id, `l-${d.id}`, c, n.id))];
        })}
        {ss.needs.map((n) => {
          const q = ifLabel[n.id];
          if (!q) return null;
          const i = ss.net.r1[n.id];
          const text = `R1 ${ssShortIf(n.iface)} ${i?.ip ? `${i.ip}/${i.prefix}` : "unassigned"}`;
          const w = text.length * (fs - 1.5) * 0.62 + 10;
          return (
            <g key={`if-${n.id}`} data-wire={n.id}>
              <rect x={q.x - w / 2} y={q.y - 9} width={w} height={17} rx={4} fill="#0b1220" fillOpacity={0.95} stroke={i?.ip ? "#22d3ee" : "#f87171"} strokeOpacity={0.5} />
              <text x={q.x} y={q.y + 4} textAnchor="middle" fill={i?.ip ? "#e8edf9" : "#f87171"} fontSize={fs - 1.5} fontFamily="ui-monospace, monospace">
                {text}
              </text>
            </g>
          );
        })}
        {node("r1", "R1", `${ss.needs.filter((n) => ss.net.r1[n.id]?.ip).length}/${ss.needs.length} interfaces`, "#22d3ee", "router", 124)}
        {ss.needs.filter((n) => n.kind === "lan").map((n) => node(`sw:${n.id}`, `SW-${n.id}`, "", color(n.id), "switch", narrow ? 100 : 112, n.id))}
        {devs.map((d) => {
          const h = ss.net.hosts[d.id];
          return node(d.id, d.name, h?.ip ? `${h.ip}/${h.prefix}` : "no address", d.os === "router" ? "#22d3ee" : color(d.wire), d.os === "router" ? "router" : "host", narrow ? 150 : 160, d.wire);
        })}
        {frame &&
          frame.kind !== "drop" &&
          frame.paths.map((p, i) => {
            const pts = p.map((n) => pos[n]).filter(Boolean);
            if (pts.length < 2) return null;
            const d = `M ${pts.map((q) => `${q.x} ${q.y}`).join(" L ")}`;
            const end = pts[pts.length - 1];
            return reduced() ? (
              <circle key={`${idx}-${i}`} cx={end.x} cy={end.y} r={7} fill={KIND_COLOR[frame.kind]} />
            ) : (
              <circle key={`${idx}-${i}`} r={7} fill={KIND_COLOR[frame.kind]} stroke="#0b1220" strokeWidth={2}>
                <animateMotion dur={`${Math.min(1, 0.32 * (pts.length - 1))}s`} fill="freeze" path={d} begin="indefinite" ref={(el) => (el as unknown as SVGAnimationElement | null)?.beginElement?.()} />
              </circle>
            );
          })}
      </svg>
      </div>
      {ping && frames.length > 0 && (
        <div className="mt-1.5 shrink-0 space-y-1 rounded-xl border border-pv-border bg-pv-bg/60 p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => (idx >= frames.length - 1 ? (setIdx(0), setPlaying(true)) : setPlaying((p) => !p))} className="rounded-full border border-pv-cyan/60 px-3 py-0.5 text-[12.5px] font-semibold text-pv-cyan-soft">
              {playing ? "Pause" : idx >= frames.length - 1 ? "Replay" : "Play"}
            </button>
            <button type="button" aria-label="Previous frame" onClick={() => (setPlaying(false), setIdx((i) => Math.max(0, i - 1)))} disabled={idx <= 0} className="rounded-full border border-pv-border px-2.5 py-0.5 text-[12.5px] text-pv-text-muted disabled:opacity-40">
              ◀
            </button>
            <button type="button" aria-label="Next frame" onClick={() => (setPlaying(false), setIdx((i) => Math.min(frames.length - 1, i + 1)))} disabled={idx >= frames.length - 1} className="rounded-full border border-pv-border px-2.5 py-0.5 text-[12.5px] text-pv-text-muted disabled:opacity-40">
              ▶
            </button>
            <span className="text-[12px] text-pv-text-faint">
              frame {idx + 1}/{frames.length}
            </span>
            {frame && (
              <span className="ml-auto flex items-center gap-1 text-[12px] font-semibold" style={{ color: KIND_COLOR[frame.kind] }}>
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: KIND_COLOR[frame.kind] }} />
                {KIND_LABEL[frame.kind]}
              </span>
            )}
          </div>
          {frame && <p className={clsx("text-[13px] leading-snug", frame.ok ? "text-pv-text" : "text-pv-danger")} aria-live="polite">{frame.text}</p>}
        </div>
      )}
    </figure>
  );
}

/** Device addresses on the address board: which squares of a block the devices of that LAN really use. */
export function deviceMarks(ss: SsState): { o: number; tag: string; wire: string; ok: boolean }[] {
  const p0 = ssParent(ss).network.split(".").map(Number).reduce((a, x) => a * 256 + x, 0);
  const num = (ip: string) => ip.split(".").map(Number).reduce((a, x) => a * 256 + x, 0);
  const out: { o: number; tag: string; wire: string; ok: boolean }[] = [];
  for (const n of ss.needs) {
    const row = ssCheck(ssParent(ss), ss.needs, ss.rows, n.id);
    const i = ss.net.r1[n.id];
    if (i?.ip) out.push({ o: num(i.ip) - p0, tag: "R", wire: n.id, ok: !!row && ssNetOf(i.ip, row.prefix) === row.real });
    ssDevices(ss.needs)
      .filter((d) => d.wire === n.id)
      .forEach((d) => {
        const h = ss.net.hosts[d.id];
        if (h?.ip) out.push({ o: num(h.ip) - p0, tag: d.os === "router" ? "R2" : String(d.k + 1), wire: n.id, ok: !!row && ssNetOf(h.ip, row.prefix) === row.real });
      });
  }
  return out.filter((m) => m.o >= 0 && m.o < 256);
}
