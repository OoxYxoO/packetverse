"use client";

import { useEffect, useRef, useState } from "react";
import { BCAST, HOSTS, R1_IFS, type ArpFrame } from "@/lib/sim-engine/scenarios/arpNet";
import { PLANS, type Arrow, type Flow, type Mark, type Shot } from "./screenplay";
import { FAR, LAN, LINKS, PORT, POS, type Layout, type Pt, type Rect, type Spot } from "./world";

/**
 * The picture. One SVG world seen through a moving camera, in two skins that share the same spots: the OFFICE
 * (people, desks, a door) and the NETWORK (devices, cables). Frames travel the cables exactly as the ARP model's
 * waves say; effects (the broadcast ripple, the one-to-one reply beam, the wall a broadcast can't cross) are drawn
 * on top. Time-driven parts read the clip clock, so pausing the video freezes them.
 */

const r = (n: number) => Math.round(n * 10) / 10;
/** A CSS duration that follows the playback rate (the theater sets --pv-rate). */
const rated = (s: number) => `calc(${s}s / var(--pv-rate, 1))`;
const lerp = (a: Pt, b: Pt, p: number): Pt => [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p];
const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
const RADIUS: Record<Spot, number> = { laptop: 105, pcb: 100, pcc: 100, r1: 105, server: 95, sw1: 130 };

/**
 * The camera: eases the viewBox toward its target between shots, at the playback rate (faster at 2×, like the rest
 * of the picture). When the stage itself changes (resize, phone rotation, first measurement) it cuts straight to the
 * new framing.
 */
export function useCamera(target: Rect, stageKey: string, rate = 1): Rect {
  const rateRef = useRef(rate);
  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);
  const [vb, setVb] = useState(target);
  const cur = useRef(target);
  const tgt = useRef(target);
  const lastKey = useRef(stageKey);
  useEffect(() => {
    tgt.current = target;
    if (lastKey.current !== stageKey) {
      lastKey.current = stageKey;
      cur.current = target;
      queueMicrotask(() => setVb(target));
      return;
    }
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      const c = cur.current;
      const k = 1 - Math.exp((-dt * rateRef.current) / 170);
      const n = { x: c.x + (tgt.current.x - c.x) * k, y: c.y + (tgt.current.y - c.y) * k, w: c.w + (tgt.current.w - c.w) * k, h: c.h + (tgt.current.h - c.h) * k };
      const done = Math.abs(n.x - tgt.current.x) + Math.abs(n.y - tgt.current.y) + Math.abs(n.w - tgt.current.w) < 0.5;
      cur.current = done ? tgt.current : n;
      setVb(cur.current);
      if (!done) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target.x, target.y, target.w, target.h, stageKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return vb;
}

function chip(f: ArpFrame): { label: string; fill: string; text: string; glow: string } {
  if (f.type === "ARP") return f.arp!.op === "request" ? { label: "ARP ?", fill: "#f59e0b", text: "#1a1203", glow: "#fbbf24" } : { label: "ARP ✓", fill: "#22d3ee", text: "#03131a", glow: "#67e8f9" };
  return f.ip!.icmp === "echo-request" ? { label: "ping", fill: "#a78bfa", text: "#12082a", glow: "#c4b5fd" } : { label: "reply", fill: "#c4b5fd", text: "#12082a", glow: "#ddd6fe" };
}

/** Frames on the wires at clip time t (waves one after another; hold = the last one waiting at arrival). */
function inFlight(flow: Flow | null, t: number, start: number) {
  if (!flow) return undefined;
  const plan = PLANS[flow.plan];
  const ms = flow.ms ?? 1300;
  if (flow.hold) return { wave: plan.waves[flow.waves[flow.waves.length - 1]], p: 1 };
  if (start === -Infinity) return undefined;
  const k = Math.floor((t - start) / ms);
  if (k < 0 || k >= flow.waves.length) return undefined;
  return { wave: plan.waves[flow.waves[k]], p: Math.min(1, (t - start - k * ms) / (ms * 0.88)) };
}

export interface StageProps {
  shot: Shot;
  layout: Layout;
  viewBox: Rect;
  /** Screen pixels per world unit (keeps text readable at any zoom). */
  ppu: number;
  /** ms into the current clip, and when its frame flow started. */
  t: number;
  flowStart: number;
  pickable?: Spot[];
  onPick?: (s: Spot) => void;
  tried?: string[];
  right?: string;
  dimScene?: boolean;
}

export function Stage({ shot, layout, viewBox, ppu, t, flowStart, pickable = [], onPick, tried = [], right, dimScene }: StageProps) {
  const P = POS[layout];
  const lan = LAN[layout];
  const far = FAR[layout];
  const fs = (base: number, minPx: number) => r(Math.max(base, minPx / Math.max(ppu, 0.01)));
  const net = shot.skin === "net";
  const fly = net ? inFlight(shot.flow, t, flowStart) : undefined;
  const fx = new Set(shot.fx);
  const lit = new Map<number, string>();
  if (fly && fly.p > 0.05)
    for (const c of fly.wave.copies) {
      const port = c.from === "sw1" ? PORT[c.to as Spot] : c.to === "sw1" ? PORT[c.from as Spot] : undefined;
      if (port) lit.set(port, c.frame.ethDst === BCAST ? "#f59e0b" : "#22d3ee");
    }
  const dimmed = (s: Spot) => fx.has("dim-others") && !shot.hi.includes(s);
  const ripple = fx.has("ripple") || fx.has("ripple-wall") || fx.has("shout");
  const rippleFrom: Pt = fx.has("shout") ? P.laptop : P.sw1;

  return (
    <svg viewBox={`${r(viewBox.x)} ${r(viewBox.y)} ${r(viewBox.w)} ${r(viewBox.h)}`} className="absolute inset-0 block h-full w-full select-none" role="img" aria-label={net ? "The network: the Laptop, PC-B and PC-C on a switch, the router R1, and the Server behind it" : "An office: you, your colleagues, and the front desk by the door"} style={{ opacity: dimScene ? 0.28 : 1, transition: `opacity ${rated(0.4)}` }}>
      <defs>
        <radialGradient id="pv-bg" cx="50%" cy="45%" r="75%">
          <stop offset="0%" stopColor="#0f1a2e" />
          <stop offset="100%" stopColor="#05080f" />
        </radialGradient>
        <clipPath id="pv-lan">
          <rect x={lan.x} y={lan.y} width={lan.w} height={lan.h} rx={46} />
        </clipPath>
        <filter id="pv-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>
      <rect x={viewBox.x - 2000} y={viewBox.y - 2000} width={viewBox.w + 4000} height={viewBox.h + 4000} fill="url(#pv-bg)" />

      {/* ------------------------------------------------ the office skin */}
      <g style={{ opacity: net ? 0 : 1, transition: `opacity ${rated(1)} ease` }} aria-hidden={net}>
        <Office P={P} lan={lan} far={far} shot={shot} fx={fx} fs={fs} t={t} layout={layout} />
      </g>

      {/* ------------------------------------------------ the network skin */}
      <g style={{ opacity: net ? 1 : 0, transition: `opacity ${rated(1)} ease` }} aria-hidden={!net}>
        <rect x={lan.x} y={lan.y} width={lan.w} height={lan.h} rx={46} fill="#22d3ee" fillOpacity={0.035} stroke="#22d3ee" strokeOpacity={fx.has("ripple-wall") || fx.has("lan-glow") ? 0.25 + 0.5 * Math.abs(Math.sin(t / 260)) : 0.2} strokeWidth={fx.has("ripple-wall") || fx.has("lan-glow") ? 6 : 3} strokeDasharray="14 12" />
        <text x={lan.x + 30} y={lan.y + 48} fontSize={fs(26, 10)} fill="#67e8f9" fillOpacity={0.7} className="pv-mono">
          your network · 192.168.10.0/24
        </text>
        {shot.far && (
          <g className="pv-v-in">
            <rect x={far.x} y={far.y} width={far.w} height={far.h} rx={40} fill="#a78bfa" fillOpacity={0.05} stroke="#a78bfa" strokeOpacity={0.3} strokeWidth={3} strokeDasharray="14 12" />
            <text x={far.x + 22} y={far.y + 40} fontSize={fs(24, 10)} fill="#c4b5fd" fillOpacity={0.8} className="pv-mono">
              another network · 10.20.20.0/24
            </text>
          </g>
        )}
        {LINKS.filter(([a, b]) => shot.far || (a !== "server" && b !== "server")).map(([a, b]) => (
          <line key={`${a}-${b}`} x1={P[a][0]} y1={P[a][1]} x2={P[b][0]} y2={P[b][1]} stroke="#334155" strokeWidth={6} strokeLinecap="round" opacity={dimmed(a) && dimmed(b) ? 0.35 : 1} />
        ))}
        {/* switch ports */}
        {(["laptop", "r1", "pcb", "pcc"] as Spot[]).map((s) => {
          const n = PORT[s]!;
          const [x, y] = lerp(P.sw1, P[s], RADIUS.sw1 / Math.hypot(P[s][0] - P.sw1[0], P[s][1] - P.sw1[1]));
          const c = lit.get(n);
          return (
            <g key={s}>
              {c && <circle cx={r(x)} cy={r(y)} r={30} fill={c} opacity={0.45} filter="url(#pv-glow)" />}
              <circle cx={r(x)} cy={r(y)} r={13} fill={c ?? "#1e293b"} stroke={c ?? "#475569"} strokeWidth={3} />
              {fx.has("ports") && (
                <text x={r(x)} y={r(y - 24)} textAnchor="middle" fontSize={fs(24, 10)} fontWeight={700} fill={c ? "#fde68a" : "#94a3b8"}>
                  {n}
                </text>
              )}
            </g>
          );
        })}
        {/* the broadcast ripple, confined to the local network */}
        {net && ripple && <Ripple from={rippleFrom} t={t} clip="pv-lan" color={fx.has("ripple-wall") ? "#fb7185" : "#f59e0b"} />}
        {fx.has("reply-beam") && <Beam a={P.pcb} b={P.laptop} t={t} />}
        {(Object.keys(P) as Spot[])
          .filter((s) => shot.far || s !== "server")
          .map((s) => (
            <Device key={s} s={s} at={P[s]} hi={shot.hi.includes(s)} dim={dimmed(s)} ip={shot.ips.includes(s)} mac={fx.has("macs")} fs={fs} pick={pickable.includes(s) ? onPick : undefined} crossed={tried.includes(s) && s !== right} right={right === s} />
          ))}
        {fx.has("server-x") && shot.far && (
          <g className="pv-v-in">
            <line x1={P.server[0] - 70} y1={P.server[1] - 70} x2={P.server[0] + 70} y2={P.server[1] + 70} stroke="#fb7185" strokeWidth={10} strokeLinecap="round" />
            <line x1={P.server[0] + 70} y1={P.server[1] - 70} x2={P.server[0] - 70} y2={P.server[1] + 70} stroke="#fb7185" strokeWidth={10} strokeLinecap="round" />
            <text x={P.server[0]} y={P.server[1] + 150} textAnchor="middle" fontSize={fs(28, 11)} fill="#fda4af">
              never hears the broadcast
            </text>
          </g>
        )}
        {shot.arrows.map((a, i) => (
          <ArrowPath key={`${a.from}-${a.to}-${i}`} a={a} P={P} fs={fs} layout={layout} />
        ))}
        {fly?.wave.copies.map((c, i) => {
          const from = P[c.from as Spot];
          const to = P[c.to as Spot];
          const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
          const a0 = RADIUS[c.from as Spot] / len;
          const a1 = 1 - RADIUS[c.to as Spot] / len;
          const [x, y] = lerp(from, to, a0 + ease(fly.p) * Math.max(0, a1 - a0));
          const k = chip(c.frame);
          const s = Math.max(1, 11 / (22 * ppu));
          return (
            <g key={`${c.frame.id}-${i}`} transform={`translate(${r(x)} ${r(y)}) scale(${r(s)})`}>
              <rect x={-74} y={-30} width={148} height={60} rx={30} fill={k.glow} opacity={0.35} filter="url(#pv-glow)" />
              <rect x={-66} y={-26} width={132} height={52} rx={26} fill={k.fill} stroke="#05080f" strokeWidth={4} />
              <text x={0} y={9} textAnchor="middle" fontSize={26} fontWeight={800} fill={k.text}>
                {k.label}
              </text>
            </g>
          );
        })}
      </g>

      {/* marks: speech / thought pills above people and devices */}
      {shot.marks.filter((m) => shot.far || m.at !== "server").map((m) => (
        <MarkPill key={`${m.at}-${m.text}`} m={m} at={P[m.at]} fs={fs} />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------
function Device({ s, at, hi, dim, ip, mac, fs, pick, crossed, right }: { s: Spot; at: Pt; hi: boolean; dim: boolean; ip: boolean; mac: boolean; fs: (b: number, m: number) => number; pick?: (s: Spot) => void; crossed: boolean; right: boolean }) {
  const [x, y] = at;
  const name = { laptop: "Laptop", pcb: "PC-B", pcc: "PC-C", r1: "R1 · router", server: "Server", sw1: "Switch" }[s];
  const addr = { laptop: "192.168.10.10", pcb: "192.168.10.20", pcc: "192.168.10.30", r1: "192.168.10.1", server: "10.20.20.20", sw1: "" }[s];
  const nameSize = fs(32, 13);
  const ipSize = fs(28, 12);
  // the MAC, shortened (first two bytes … last byte), straight from the model
  const fullMac = s === "r1" ? R1_IFS.gi0.mac : s === "sw1" ? "" : HOSTS[s].mac;
  const macAddr = fullMac && `${fullMac.slice(0, 5)}…${fullMac.slice(-2)}`;
  const macY = y + RADIUS[s] + nameSize + 14 + (ip ? ipSize * 1.7 : 0);
  const body = (
    <g opacity={dim ? 0.28 : crossed ? 0.4 : 1} style={{ transition: `opacity ${rated(0.5)}` }}>
      {(hi || pick || right) && <circle cx={x} cy={y} r={RADIUS[s] + 22} fill={right ? "#34d399" : pick ? "#f59e0b" : "#22d3ee"} opacity={0.16} className={pick && !right ? "pv-v-pulse" : "pv-v-breathe"} />}
      {(hi || right) && <circle cx={x} cy={y} r={RADIUS[s] + 22} fill="none" stroke={right ? "#34d399" : "#22d3ee"} strokeWidth={4} opacity={0.7} />}
      <DeviceIcon s={s} x={x} y={y} />
      <text x={x} y={y + RADIUS[s] + nameSize + 4} textAnchor="middle" fontSize={nameSize} fontWeight={700} fill="#e8edf9">
        {name}
      </text>
      {ip && addr && (
        <g className="pv-v-in">
          <rect x={r(x - ipSize * 3.9)} y={r(y + RADIUS[s] + nameSize + 14)} width={r(ipSize * 7.8)} height={r(ipSize * 1.45)} rx={r(ipSize * 0.7)} fill="#0b2530" stroke="#22d3ee" strokeOpacity={0.6} strokeWidth={2} />
          <text x={x} y={r(y + RADIUS[s] + nameSize + 14 + ipSize * 1.05)} textAnchor="middle" fontSize={ipSize} fill="#a5f3fc" className="pv-mono">
            {addr}
          </text>
        </g>
      )}
      {mac && macAddr && (
        <g className="pv-v-in">
          <rect x={r(x - ipSize * 3.4)} y={r(macY)} width={r(ipSize * 6.8)} height={r(ipSize * 1.45)} rx={r(ipSize * 0.3)} fill="#1c1406" stroke="#fbbf24" strokeOpacity={0.6} strokeWidth={2} />
          <text x={x} y={r(macY + ipSize * 1.05)} textAnchor="middle" fontSize={ipSize} fill="#fde68a" className="pv-mono">
            MAC {macAddr}
          </text>
        </g>
      )}
      {crossed && <line x1={x - 90} y1={y + 90} x2={x + 90} y2={y - 90} stroke="#fb7185" strokeWidth={8} strokeLinecap="round" />}
    </g>
  );
  return pick ? (
    <g role="button" tabIndex={0} aria-label={`${name} (${addr})`} onClick={() => pick(s)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick(s))} className="cursor-pointer outline-none">
      <circle cx={x} cy={y} r={RADIUS[s] + 40} fill="transparent" />
      {body}
    </g>
  ) : (
    body
  );
}

function DeviceIcon({ s, x, y }: { s: Spot; x: number; y: number }) {
  const stroke = "#7dd3fc";
  switch (s) {
    case "laptop":
      return (
        <g>
          <rect x={x - 70} y={y - 58} width={140} height={90} rx={10} fill="#0f2233" stroke={stroke} strokeWidth={4} />
          <rect x={x - 58} y={y - 46} width={116} height={66} rx={4} fill="#123048" />
          <path d={`M ${x - 92} ${y + 40} L ${x + 92} ${y + 40} L ${x + 78} ${y + 58} L ${x - 78} ${y + 58} Z`} fill="#16324a" stroke={stroke} strokeWidth={4} />
        </g>
      );
    case "pcb":
    case "pcc":
      return (
        <g>
          <rect x={x - 66} y={y - 62} width={132} height={92} rx={10} fill="#0f2233" stroke={stroke} strokeWidth={4} />
          <rect x={x - 54} y={y - 50} width={108} height={68} rx={4} fill="#123048" />
          <rect x={x - 10} y={y + 30} width={20} height={20} fill="#16324a" />
          <rect x={x - 42} y={y + 48} width={84} height={12} rx={6} fill="#16324a" stroke={stroke} strokeWidth={3} />
        </g>
      );
    case "sw1":
      return (
        <g>
          <rect x={x - 112} y={y - 40} width={224} height={80} rx={14} fill="#0f2a38" stroke="#22d3ee" strokeWidth={4} />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <rect key={i} x={x - 84 + i * 30} y={y + 2} width={18} height={14} rx={3} fill="#164e63" />
          ))}
          <circle cx={x - 88} cy={y - 18} r={5} fill="#34d399" className="pv-v-blink" />
        </g>
      );
    case "r1":
      return (
        <g>
          <ellipse cx={x} cy={y + 22} rx={84} ry={26} fill="#16324a" stroke={stroke} strokeWidth={4} />
          <rect x={x - 84} y={y - 30} width={168} height={52} fill="#16324a" />
          <line x1={x - 84} y1={y - 30} x2={x - 84} y2={y + 22} stroke={stroke} strokeWidth={4} />
          <line x1={x + 84} y1={y - 30} x2={x + 84} y2={y + 22} stroke={stroke} strokeWidth={4} />
          <ellipse cx={x} cy={y - 30} rx={84} ry={26} fill="#1b3d58" stroke={stroke} strokeWidth={4} />
          <path d={`M ${x - 40} ${y - 30} h 80 M ${x + 26} ${y - 40} l 14 10 l -14 10 M ${x - 26} ${y - 40} l -14 10 l 14 10`} stroke="#a5f3fc" strokeWidth={4} fill="none" strokeLinecap="round" />
        </g>
      );
    case "server":
      return (
        <g>
          <rect x={x - 52} y={y - 78} width={104} height={156} rx={12} fill="#1e1b3a" stroke="#a78bfa" strokeWidth={4} />
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect x={x - 38} y={y - 60 + i * 42} width={76} height={26} rx={5} fill="#2e2a55" />
              <circle cx={x + 26} cy={y - 47 + i * 42} r={4} fill="#34d399" className="pv-v-blink" />
            </g>
          ))}
        </g>
      );
  }
}

function MarkPill({ m, at, fs }: { m: Mark; at: Pt; fs: (b: number, min: number) => number }) {
  const tone = { ok: ["#052e1c", "#34d399", "#a7f3d0"], no: ["#141a26", "#64748b", "#cbd5e1"], ask: ["#2a1d05", "#f59e0b", "#fde68a"], say: ["#0b2530", "#22d3ee", "#e0f7ff"], info: ["#1e1b3a", "#a78bfa", "#e9e5ff"] }[m.tone];
  const size = fs(30, 12.5);
  const w = Math.max(size * 2, m.text.length * size * 0.56 + size * 1.4);
  const h = size * 1.7;
  const y = at[1] - 150 - h;
  return (
    <g className="pv-v-pop" key={m.text}>
      <rect x={r(at[0] - w / 2)} y={r(y)} width={r(w)} height={r(h)} rx={r(h / 2)} fill={tone[0]} stroke={tone[1]} strokeWidth={3} />
      <path d={`M ${r(at[0] - 12)} ${r(y + h - 1)} L ${at[0]} ${r(y + h + 18)} L ${r(at[0] + 12)} ${r(y + h - 1)} Z`} fill={tone[0]} stroke={tone[1]} strokeWidth={3} />
      <rect x={r(at[0] - 13)} y={r(y + h - 4)} width={26} height={5} fill={tone[0]} />
      <text x={at[0]} y={r(y + h * 0.67)} textAnchor="middle" fontSize={size} fontWeight={700} fill={tone[2]}>
        {m.text}
      </text>
    </g>
  );
}

function Ripple({ from, t, clip, color }: { from: Pt; t: number; clip: string; color: string }) {
  return (
    <g clipPath={`url(#${clip})`}>
      {[0, 1, 2].map((i) => {
        const p = ((t / 1700 + i / 3) % 1 + 1) % 1;
        return <circle key={i} cx={from[0]} cy={from[1]} r={r(60 + p * 1100)} fill="none" stroke={color} strokeWidth={r(10 - p * 7)} opacity={r((1 - p) * 0.55)} />;
      })}
    </g>
  );
}

function Beam({ a, b, t }: { a: Pt; b: Pt; t: number }) {
  const off = -((t / 6) % 60);
  return (
    <g>
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#22d3ee" strokeWidth={22} opacity={0.18} strokeLinecap="round" />
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#67e8f9" strokeWidth={6} strokeDasharray="30 30" strokeDashoffset={r(off)} strokeLinecap="round" />
    </g>
  );
}

function ArrowPath({ a, P, fs, layout }: { a: Arrow; P: Record<Spot, Pt>; fs: (b: number, m: number) => number; layout: Layout }) {
  const [x1, y1] = P[a.from];
  const [x2, y2] = P[a.to];
  const lift = a.tone === "ip" ? (layout === "wide" ? -330 : 0) : a.tone === "mac" ? (layout === "wide" ? -150 : 0) : -120;
  const side = layout === "tall" ? (a.tone === "ip" ? -330 : a.tone === "mac" ? -160 : -120) : 0;
  const mx = (x1 + x2) / 2 + side;
  const my = (y1 + y2) / 2 + lift;
  const color = a.tone === "ip" ? "#c4b5fd" : a.tone === "mac" ? "#67e8f9" : "#94a3b8";
  // apex of the quadratic curve (t = 0.5)
  const ax = (x1 + 2 * mx + x2) / 4;
  const ay = (y1 - 60 + 2 * my + y2 - 60) / 4;
  const size = fs(30, 12.5);
  return (
    <g className="pv-v-in">
      <path d={`M ${x1} ${y1 - 60} Q ${mx} ${my} ${x2} ${y2 - 60}`} fill="none" stroke={color} strokeWidth={a.tone === "intent" ? 5 : 7} strokeDasharray={a.tone === "ip" || a.tone === "intent" ? "18 14" : undefined} markerEnd="" opacity={0.9} />
      <circle cx={x2} cy={y2 - 60} r={12} fill={color} />
      {/* the label sits on the curve's apex, on a pill so it reads over anything */}
      <rect x={r(ax - (a.label.length * size * 0.3 + size * 0.6))} y={r(ay - size * 0.85)} width={r(a.label.length * size * 0.6 + size * 1.2)} height={r(size * 1.6)} rx={r(size * 0.8)} fill="#05080f" stroke={color} strokeWidth={3} />
      <text x={r(ax)} y={r(ay + size * 0.32)} textAnchor="middle" fontSize={size} fontWeight={700} fill={color}>
        {a.label}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The office: same spots, different skin
// ---------------------------------------------------------------------------------------------------------------
function Office({ P, lan, far, shot, fx, fs, t, layout }: { P: Record<Spot, Pt>; lan: Rect; far: Rect; shot: Shot; fx: Set<string>; fs: (b: number, m: number) => number; t: number; layout: Layout }) {
  const names = fx.has("names");
  // desk numbers stand for MAC addresses: they match the last byte of each device's MAC (…:01, …:20, …:30)
  const DESK: Partial<Record<Spot, string>> = { laptop: "desk 1", pcb: "desk 20", pcc: "desk 30", r1: "front desk" };
  const person = (s: Spot, label: string, color: string) => {
    const [x, y] = P[s];
    const hi = shot.hi.includes(s);
    const unknown = fx.has("faces") && !names && s !== "laptop";
    const size = fs(32, 13);
    const dim = fx.has("dim-others") && !hi;
    // everyone turns toward the person asking
    const toward = fx.has("look") && s !== "laptop" ? Math.sign(P.laptop[0] - x) * 12 : 0;
    const hand = fx.has("hand") && s === "pcb";
    const shrug = fx.has("shrug") && (s === "pcc" || s === "r1");
    return (
      <g key={s} opacity={dim ? 0.3 : 1} style={{ transition: `opacity ${rated(0.5)}` }}>
        {hi && <circle cx={x} cy={y} r={120} fill="#22d3ee" opacity={0.14} className="pv-v-breathe" />}
        {/* arms: a raised hand, or a shrug */}
        {hand && (
          <g className="pv-v-pop">
            <path d={`M ${x + 40} ${y + 2} Q ${x + 70} ${y - 40} ${x + 62} ${y - 104}`} stroke={color} strokeWidth={16} strokeLinecap="round" fill="none" />
            <circle cx={x + 62} cy={y - 112} r={14} fill={color} />
          </g>
        )}
        {shrug && (
          <g className="pv-v-pop" opacity={0.9}>
            <path d={`M ${x - 52} ${y + 6} L ${x - 84} ${y - 24} L ${x - 96} ${y - 8}`} stroke={color} strokeWidth={12} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <path d={`M ${x + 52} ${y + 6} L ${x + 84} ${y - 24} L ${x + 96} ${y - 8}`} stroke={color} strokeWidth={12} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </g>
        )}
        <rect x={x - 95} y={y + 30} width={190} height={60} rx={10} fill="#1c2638" stroke="#334155" strokeWidth={3} />
        {fx.has("desks") && DESK[s] && (
          <text x={x} y={y + 70} textAnchor="middle" fontSize={fs(22, 10)} fontWeight={700} fill="#94a3b8" className="pv-mono">
            {DESK[s]}
          </text>
        )}
        <g style={{ transform: `translateX(${toward}px)`, transition: `transform ${rated(0.5)} ease` }}>
          <circle cx={x} cy={y - 40} r={36} fill={color} />
          {unknown && (
            <text x={x} y={y - 26} textAnchor="middle" fontSize={44} fontWeight={800} fill="#0b1020">
              ?
            </text>
          )}
        </g>
        <path d={`M ${x - 62} ${y + 40} Q ${x - 60} ${y - 6} ${x} ${y - 6} Q ${x + 60} ${y - 6} ${x + 62} ${y + 40} Z`} fill={color} opacity={0.85} />
        <text x={x} y={y + 90 + size + 6} textAnchor="middle" fontSize={size} fontWeight={700} fill="#e8edf9">
          {unknown ? "?" : label}
        </text>
      </g>
    );
  };
  const [lx, ly] = P.laptop;
  const wide = layout === "wide";
  // the letter for another building: you → front desk → out the door; then a messenger carries it on
  const letterP = ((t / 2600) % 1 + 1) % 1;
  const letterAt = letterP < 0.5 ? lerp(P.laptop, P.r1, letterP * 2) : lerp(P.r1, P.server, (letterP - 0.5) * 2);
  const runP = ((t / 3200) % 1 + 1) % 1;
  const runner = lerp(P.r1, P.server, runP);
  const sticky: Pt = wide ? [lx - 160, ly - 85] : [lx + 150, ly - 170];
  return (
    <g>
      {/* the room */}
      <rect x={lan.x} y={lan.y} width={lan.w} height={lan.h} rx={46} fill="#1a2234" fillOpacity={0.5} stroke="#64748b" strokeWidth={10} />
      {/* the door: a gap in the wall beside the front desk */}
      {wide ? (
        <g>
          <rect x={lan.x + lan.w - 9} y={P.r1[1] - 80} width={18} height={160} fill="#0a1120" />
          <line x1={lan.x + lan.w - 16} y1={P.r1[1] - 80} x2={lan.x + lan.w + 16} y2={P.r1[1] - 80} stroke="#94a3b8" strokeWidth={6} />
          <line x1={lan.x + lan.w - 16} y1={P.r1[1] + 80} x2={lan.x + lan.w + 16} y2={P.r1[1] + 80} stroke="#94a3b8" strokeWidth={6} />
        </g>
      ) : (
        <g>
          <rect x={P.r1[0] - 80} y={lan.y + lan.h - 9} width={160} height={18} fill="#0a1120" />
          <line x1={P.r1[0] - 80} y1={lan.y + lan.h - 16} x2={P.r1[0] - 80} y2={lan.y + lan.h + 16} stroke="#94a3b8" strokeWidth={6} />
          <line x1={P.r1[0] + 80} y1={lan.y + lan.h - 16} x2={P.r1[0] + 80} y2={lan.y + lan.h + 16} stroke="#94a3b8" strokeWidth={6} />
        </g>
      )}
      <text x={lan.x + 30} y={lan.y + 48} fontSize={fs(28, 11)} fill="#94a3b8">
        the office
      </text>
      {shot.far && (
        <g className="pv-v-in">
          <rect x={far.x} y={far.y} width={far.w} height={far.h} rx={30} fill="#1e1b3a" fillOpacity={0.6} stroke="#a78bfa" strokeOpacity={0.5} strokeWidth={6} />
          <text x={far.x + 24} y={far.y + 40} fontSize={fs(26, 10)} fill="#c4b5fd">
            another building
          </text>
        </g>
      )}
      {fx.has("shout") && <Ripple from={P.laptop} t={t} clip="pv-lan" color="#f59e0b" />}
      {fx.has("reply-beam") && <Beam a={P.pcb} b={P.laptop} t={t} />}
      {/* a water cooler where the switch will be */}
      <g opacity={0.6}>
        <rect x={P.sw1[0] - 26} y={P.sw1[1] - 50} width={52} height={100} rx={10} fill="#1e3a5f" stroke="#64748b" strokeWidth={3} />
        <circle cx={P.sw1[0]} cy={P.sw1[1] - 62} r={20} fill="#7dd3fc" opacity={0.6} />
      </g>
      {person("laptop", "You", "#38bdf8")}
      {person("pcb", "Sam", "#fbbf24")}
      {person("pcc", "Priya", "#f472b6")}
      {person("r1", "Front desk", "#a78bfa")}
      {shot.far && person("server", "Alex", "#c4b5fd")}
      {fx.has("note") && (
        <g className="pv-v-pop">
          <rect x={lx + 70} y={ly - 110} width={190} height={92} rx={8} fill="#f8fafc" transform={`rotate(-6 ${lx + 165} ${ly - 64})`} />
          <text x={lx + 165} y={ly - 58} textAnchor="middle" fontSize={fs(30, 12)} fill="#0f172a" fontWeight={700} transform={`rotate(-6 ${lx + 165} ${ly - 64})`}>
            For: Sam
          </text>
        </g>
      )}
      {fx.has("sticky") && (
        <g className="pv-v-pop" transform={`rotate(5 ${sticky[0]} ${sticky[1]})`}>
          <rect x={sticky[0] - 105} y={sticky[1] - 68} width={210} height={136} rx={6} fill="#fde047" />
          <g className={fx.has("write") ? "pv-v-write" : undefined}>
            <text x={sticky[0]} y={sticky[1] - 14} textAnchor="middle" fontSize={fs(30, 12)} fill="#422006" fontWeight={800}>
              Sam →
            </text>
            <text x={sticky[0]} y={sticky[1] + 28} textAnchor="middle" fontSize={fs(30, 12)} fill="#422006" fontWeight={800}>
              desk 20
            </text>
          </g>
          {fx.has("write") && <path d={`M ${sticky[0] + 60} ${sticky[1] + 40} l 46 -46 l 10 10 l -46 46 z`} fill="#1e293b" className="pv-v-pen" />}
        </g>
      )}
      {fx.has("far-letter") && shot.far && (
        <g transform={`translate(${r(letterAt[0])} ${r(letterAt[1] - 40)})`}>
          <rect x={-46} y={-30} width={92} height={60} rx={6} fill="#f8fafc" stroke="#a78bfa" strokeWidth={3} />
          <path d="M -46 -30 L 0 6 L 46 -30" fill="none" stroke="#a78bfa" strokeWidth={3} />
        </g>
      )}
      {fx.has("messenger") && shot.far && (
        <g transform={`translate(${r(runner[0])} ${r(runner[1] - 10)})`}>
          <circle cx={0} cy={-58} r={22} fill="#34d399" />
          <path d="M -34 10 Q -32 -30 0 -30 Q 32 -30 34 10 Z" fill="#34d399" opacity={0.85} />
          <rect x={14} y={-26} width={52} height={36} rx={5} fill="#f8fafc" stroke="#a78bfa" strokeWidth={3} />
          <text x={0} y={46} textAnchor="middle" fontSize={fs(22, 10)} fill="#a7f3d0" fontWeight={700}>
            messenger
          </text>
        </g>
      )}
    </g>
  );
}
