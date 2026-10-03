"use client";

import type { CSSProperties, KeyboardEvent } from "react";
import { clsx } from "clsx";
import type { CliVendor } from "@/lib/cli/types";
import { ADDR, DEVICE_HOSTNAME, GRAPH_NODES, SUBNETS } from "@/lib/sim-engine/scenarios/firstConnection";
import { ARP_LAB_PATHS, arpLabPacket, type ArpLabNode, type ArpLabState, type ArpLabTransit } from "@/lib/sim-engine/scenarios/arpLab";
import { interfaceAlias } from "../cliAdapter";

/**
 * The guided lesson's own network — Laptop, Access Switch (SW1),
 * Router (R1), Server — drawn as a flat 2D workbench. Names, addresses
 * and subnets come from firstConnection.ts and interface aliases from
 * the CLI adapter, so labels follow the selected vendor without
 * touching state. The Router sits on the boundary between the two
 * broadcast domains, and no frame path ever reaches the Server.
 *
 * Two layouts share one renderer: "wide" (one row) and "compact" (one
 * column, phones). On compact, the in-diagram cue chips move to an HTML
 * strip under the drawing so device cards stay large and readable.
 */

export const ARP_LAB_SEGMENT_MS = 1200;

type Pt = { x: number; y: number };
interface PortLabel {
  text: (v: CliVendor) => string;
  x: number;
  y: number;
  anchor: "start" | "end";
}
interface Layout {
  wide: boolean;
  w: number;
  h: number;
  nodeW: number;
  nodeH: number;
  pos: Record<ArpLabNode, Pt>;
  links: [Pt, Pt][];
  lan: { x: number; y: number; w: number; h: number };
  server: { x: number; y: number; w: number; h: number };
  boundary: [Pt, Pt];
  lanLabel: Pt;
  serverLabel: Pt & { anchor: "start" | "end" };
  serverNote: Pt;
  packetOffset: Pt;
  ports: PortLabel[];
}

const sw = (id: "port1" | "port2") => (v: CliVendor) => interfaceAlias(v, { kind: "switch", id });
const r1 = (id: "lan" | "server") => (v: CliVendor) => interfaceAlias(v, { kind: "router", id });
const eth0 = () => "eth0";

const WIDE: Layout = {
  wide: true,
  w: 820,
  h: 262,
  nodeW: 128,
  nodeH: 72,
  pos: { laptop: { x: 95, y: 146 }, switch: { x: 300, y: 146 }, router: { x: 530, y: 146 }, server: { x: 728, y: 146 } },
  links: [
    [{ x: 159, y: 146 }, { x: 236, y: 146 }],
    [{ x: 364, y: 146 }, { x: 466, y: 146 }],
    [{ x: 594, y: 146 }, { x: 664, y: 146 }],
  ],
  lan: { x: 14, y: 40, w: 516, h: 214 },
  server: { x: 530, y: 40, w: 276, h: 214 },
  boundary: [{ x: 530, y: 34 }, { x: 530, y: 254 }],
  lanLabel: { x: 28, y: 60 },
  serverLabel: { x: 792, y: 60, anchor: "end" },
  serverNote: { x: 728, y: 202 },
  packetOffset: { x: 0, y: -58 },
  ports: [
    { text: eth0, x: 164, y: 166, anchor: "start" },
    { text: sw("port1"), x: 231, y: 136, anchor: "end" },
    { text: sw("port2"), x: 369, y: 136, anchor: "start" },
    { text: r1("lan"), x: 461, y: 166, anchor: "end" },
    { text: r1("server"), x: 599, y: 136, anchor: "start" },
    { text: eth0, x: 659, y: 166, anchor: "end" },
  ],
};

const COMPACT: Layout = {
  wide: false,
  w: 400,
  h: 480,
  nodeW: 168,
  nodeH: 62,
  pos: { laptop: { x: 250, y: 70 }, switch: { x: 250, y: 176 }, router: { x: 250, y: 292 }, server: { x: 250, y: 400 } },
  links: [
    [{ x: 250, y: 101 }, { x: 250, y: 145 }],
    [{ x: 250, y: 207 }, { x: 250, y: 261 }],
    [{ x: 250, y: 323 }, { x: 250, y: 369 }],
  ],
  lan: { x: 6, y: 24, w: 388, h: 268 },
  server: { x: 6, y: 292, w: 388, h: 182 },
  boundary: [{ x: 6, y: 292 }, { x: 394, y: 292 }],
  lanLabel: { x: 16, y: 42 },
  serverLabel: { x: 16, y: 466, anchor: "start" },
  serverNote: { x: 250, y: 448 },
  packetOffset: { x: -168, y: 0 },
  ports: [
    { text: eth0, x: 242, y: 116, anchor: "end" },
    { text: sw("port1"), x: 242, y: 140, anchor: "end" },
    { text: sw("port2"), x: 242, y: 224, anchor: "end" },
    { text: r1("lan"), x: 242, y: 256, anchor: "end" },
    { text: r1("server"), x: 242, y: 340, anchor: "end" },
    { text: eth0, x: 242, y: 364, anchor: "end" },
  ],
};

const KIND_COLOR = { "arp-request": "#f59e0b", "arp-reply": "#f59e0b", "ip-frame": "#60a5fa" } as const;
const KIND_SHORT = { "arp-request": "ARP Req", "arp-reply": "ARP Reply", "ip-frame": "IPv4" } as const;
const ACCENT: Record<ArpLabNode, string> = { laptop: "#67e8f9", switch: "#94a3b8", router: "#60a5fa", server: "#34d399" };

const nodeLabel = (id: ArpLabNode) => GRAPH_NODES.find((n) => n.id === id)?.label ?? id;
const NODE_SUB: Record<ArpLabNode, string> = {
  laptop: ADDR.laptop.ip,
  switch: `${DEVICE_HOSTNAME.switch} · Layer 2`,
  router: `${DEVICE_HOSTNAME.router} · gateway`,
  server: ADDR.server.ip,
};

export interface ArpLabTopologyProps {
  lab: ArpLabState;
  vendor: CliVendor;
  /** Frame to draw — normally lab.transit; a replay passes its own copy (animation only, never state). */
  transit?: ArpLabTransit;
  selectedDevice?: ArpLabNode;
  onSelectDevice: (id: ArpLabNode) => void;
  onInspectPacket: () => void;
  packetSelected: boolean;
  /** True once the learner answered the ARP-target prediction — only then does the Server label say why it is left out. */
  scopeRevealed: boolean;
}

interface Cues {
  requestInFlight: boolean;
  requestDone: boolean;
  decision?: string;
  learned: Partial<Record<ArpLabNode, string>>;
}

function cuesFor({ lab, transit, vendor }: ArpLabTopologyProps): Cues {
  const path = transit ? ARP_LAB_PATHS[transit.kind] : undefined;
  const learned: Cues["learned"] = {};
  if (lab.learned.some((l) => l.table === "switch-mac")) learned.switch = "+ MAC → port learned";
  if (lab.learned.some((l) => l.table === "router-arp")) learned.router = "+ ARP entry learned";
  if (lab.learned.some((l) => l.table === "laptop-arp")) learned.laptop = "+ ARP entry learned";
  return {
    requestInFlight: transit?.kind === "arp-request" && !transit.done,
    requestDone: lab.transit?.kind === "arp-request" && lab.transit.done,
    decision:
      transit?.switchDecision && path && path.indexOf("switch") <= transit.hop
        ? `${transit.switchDecision.action} → ${transit.switchDecision.ports.map((id) => interfaceAlias(vendor, { kind: "switch", id })).join(", ")}`
        : undefined,
    learned,
  };
}

function TopologySvg(props: ArpLabTopologyProps & { layout: Layout; cues: Cues; className: string }) {
  const { layout: L, cues, lab, vendor, transit, selectedDevice, onSelectDevice, onInspectPacket, packetSelected, scopeRevealed, className } = props;
  const path = transit ? ARP_LAB_PATHS[transit.kind] : undefined;
  const packet = transit ? arpLabPacket(transit.kind) : undefined;
  const from = transit && path ? L.pos[path[transit.hop]] : undefined;
  const to = transit && path && !transit.done ? L.pos[path[transit.hop + 1]] : undefined;
  const onPath = new Set<ArpLabNode>(transit && !transit.done && path ? path : []);
  const halfW = L.nodeW / 2;
  const halfH = L.nodeH / 2;
  const hot = cues.requestInFlight;
  const key = (e: KeyboardEvent, fn: () => void) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };

  return (
    <svg
      viewBox={`0 0 ${L.w} ${L.h}`}
      className={clsx("h-full w-full", className)}
      role="group"
      aria-label={`Lab topology — the lesson's network. Laptop ${ADDR.laptop.ip}, Access Switch ${DEVICE_HOSTNAME.switch} and Router ${DEVICE_HOSTNAME.router} on ${SUBNETS.lan.network}; Server ${ADDR.server.ip} on ${SUBNETS.server.network}.${packet ? ` Frame on the wire: ${packet.summary}.` : ""}`}
    >
      <rect x={L.lan.x} y={L.lan.y} width={L.lan.w} height={L.lan.h} rx={16} fill={hot ? "#f59e0b" : "#22d3ee"} fillOpacity={hot ? 0.12 : 0.04} stroke={hot ? "#f59e0b" : "#22d3ee"} strokeOpacity={hot ? 0.85 : 0.3} strokeDasharray="6 5" className={hot ? "pv-lab-domain" : undefined} />
      <rect x={L.server.x} y={L.server.y} width={L.server.w} height={L.server.h} rx={16} fill="#34d399" fillOpacity={0.03} stroke="#34d399" strokeOpacity={0.22} strokeDasharray="6 5" />
      <line x1={L.boundary[0].x} y1={L.boundary[0].y} x2={L.boundary[1].x} y2={L.boundary[1].y} stroke={hot || cues.requestDone ? "#fbbf24" : "#e2e8f0"} strokeOpacity={hot || cues.requestDone ? 0.75 : 0.18} strokeWidth={2} strokeDasharray="3 4" />

      <text x={L.lanLabel.x} y={L.lanLabel.y} fill={hot ? "#fbbf24" : "#67e8f9"} fontSize={12} fontWeight={700}>
        {hot ? "ARP BROADCAST FLOODS · " : "LAN · BROADCAST DOMAIN · "}
        {SUBNETS.lan.network}
      </text>
      <text x={L.serverLabel.x} y={L.serverLabel.y} textAnchor={L.serverLabel.anchor} fill="#34d399" fillOpacity={0.75} fontSize={12} fontWeight={700}>
        {SUBNETS.server.label.toUpperCase()} · {SUBNETS.server.network}
      </text>

      {L.links.map(([a, b], i) => (
        <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={i === 2 ? "#1e293b" : hot ? "#b45309" : "#334155"} strokeWidth={3} />
      ))}
      {L.ports.map((p, i) => (
        <text key={i} x={p.x} y={p.y} textAnchor={p.anchor} fill="#94a3b8" fontSize={12} fontFamily="ui-monospace, monospace" opacity={i === 5 ? 0.45 : 1}>
          {p.text(vendor)}
        </text>
      ))}

      {(["laptop", "switch", "router", "server"] as const).map((id) => {
        const { x, y } = L.pos[id];
        const selected = selectedDevice === id;
        const active = onPath.has(id);
        return (
          <g
            key={id}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={`${nodeLabel(id)}${id === "switch" || id === "router" ? ` (${DEVICE_HOSTNAME[id]})` : ""} — show details`}
            onClick={() => onSelectDevice(id)}
            onKeyDown={(e) => key(e, () => onSelectDevice(id))}
            className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-white"
            opacity={id === "server" ? 0.5 : 1}
          >
            <rect x={x - halfW} y={y - halfH} width={L.nodeW} height={L.nodeH} rx={12} fill="#0b1220" stroke={selected ? "#e2e8f0" : ACCENT[id]} strokeOpacity={active || selected ? 1 : 0.6} strokeWidth={active || selected ? 2.5 : 1.5} />
            <text x={x} y={y - 7} textAnchor="middle" fill="#e2e8f0" fontSize={15} fontWeight={700}>
              {nodeLabel(id)}
            </text>
            <text x={x} y={y + 15} textAnchor="middle" fill="#94a3b8" fontSize={12} fontFamily="ui-monospace, monospace">
              {NODE_SUB[id]}
            </text>
          </g>
        );
      })}
      <text x={L.serverNote.x} y={L.serverNote.y} textAnchor="middle" fill="#64748b" fontSize={11}>
        {scopeRevealed ? "Not in this ARP broadcast domain" : "Remote network"}
      </text>

      {L.wide && (
        <>
          {(["laptop", "switch", "router"] as const).map((id) =>
            cues.learned[id] ? (
              <g key={`tag-${id}-${lab.transit?.id}`} className="pv-lab-pop">
                <rect x={L.pos[id].x - 78} y={L.pos[id].y + halfH + 8} width={156} height={24} rx={12} fill="#10b981" fillOpacity={0.15} stroke="#10b981" strokeOpacity={0.6} />
                <text x={L.pos[id].x} y={L.pos[id].y + halfH + 24} textAnchor="middle" fill="#34d399" fontSize={12} fontWeight={700}>
                  {cues.learned[id]}
                </text>
              </g>
            ) : null,
          )}
          {(cues.requestInFlight || cues.requestDone) && (
            <g key={`boundary-${lab.transit?.id}`} className="pv-lab-pop">
              <rect x={L.pos.router.x - 116} y={10} width={232} height={22} rx={6} fill="#0f172a" stroke="#fbbf24" strokeOpacity={0.6} />
              <text x={L.pos.router.x} y={25} textAnchor="middle" fill="#fbbf24" fontSize={12} fontWeight={700}>
                {cues.requestDone ? "ARP broadcast did not cross R1" : "R1 = broadcast boundary"}
              </text>
            </g>
          )}
          {cues.decision && (
            <g key={`decision-${transit!.id}`} className="pv-lab-pop">
              <rect x={L.pos.switch.x - 125} y={222} width={250} height={22} rx={6} fill="#0f172a" stroke="#94a3b8" strokeOpacity={0.5} />
              <text x={L.pos.switch.x} y={237} textAnchor="middle" fill="#cbd5e1" fontSize={12} fontWeight={700} fontFamily="ui-monospace, monospace">
                SW1: {cues.decision}
              </text>
            </g>
          )}
        </>
      )}

      {transit && packet && from && (
        <g
          key={`${transit.id}-${transit.hop}-${transit.done ? "rest" : "move"}`}
          className={to ? "pv-lab-moving" : undefined}
          style={
            to
              ? ({
                  ["--fx" as string]: `${from.x + L.packetOffset.x}px`,
                  ["--fy" as string]: `${from.y + L.packetOffset.y}px`,
                  ["--tx" as string]: `${to.x + L.packetOffset.x}px`,
                  ["--ty" as string]: `${to.y + L.packetOffset.y}px`,
                  animation: `pv-lab-hop ${ARP_LAB_SEGMENT_MS}ms ease-in-out forwards`,
                } as CSSProperties)
              : { transform: `translate(${from.x + L.packetOffset.x}px, ${from.y + L.packetOffset.y}px)` }
          }
        >
          <g role="button" tabIndex={0} aria-label={`Inspect frame: ${packet.summary}`} onClick={onInspectPacket} onKeyDown={(e) => key(e, onInspectPacket)} className="cursor-pointer outline-none">
            <rect x={-46} y={-15} width={92} height={30} rx={15} fill={KIND_COLOR[transit.kind]} fillOpacity={transit.done ? 0.4 : 0.92} stroke={packetSelected ? "#e2e8f0" : "none"} strokeWidth={2} />
            <text x={0} y={5} textAnchor="middle" fill="#0b1220" fontSize={13} fontWeight={800}>
              {KIND_SHORT[transit.kind]}
            </text>
          </g>
        </g>
      )}
    </svg>
  );
}

export function ArpLabTopology(props: ArpLabTopologyProps) {
  const cues = cuesFor(props);
  const compactCues = [
    cues.requestInFlight ? "Broadcast flooding 192.168.10.0/24 — R1 is the boundary" : cues.requestDone ? "ARP broadcast did not cross R1" : undefined,
    cues.decision ? `SW1: ${cues.decision}` : undefined,
    ...(["switch", "router", "laptop"] as const).map((id) => (cues.learned[id] ? `${id === "switch" ? "SW1" : id === "router" ? "R1" : "Laptop"} ${cues.learned[id]}` : undefined)),
  ].filter((c): c is string => !!c);

  return (
    <div className="flex h-full w-full flex-col">
      <style>{`
        @keyframes pv-lab-hop { from { transform: translate(var(--fx), var(--fy)); } to { transform: translate(var(--tx), var(--ty)); } }
        @keyframes pv-lab-pop { 0% { opacity: 0; } 100% { opacity: 1; } }
        @keyframes pv-lab-domain { 0%,100% { fill-opacity: .06; } 50% { fill-opacity: .18; } }
        .pv-lab-pop { animation: pv-lab-pop 400ms ease-out both; }
        .pv-lab-domain { animation: pv-lab-domain 1.2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .pv-lab-moving, .pv-lab-pop, .pv-lab-domain { animation-duration: 1ms !important; animation-iteration-count: 1 !important; } }
      `}</style>
      <div className="min-h-0 flex-1">
        <TopologySvg {...props} layout={WIDE} cues={cues} className="hidden sm:block" />
        <TopologySvg {...props} layout={COMPACT} cues={cues} className="sm:hidden" />
      </div>
      {compactCues.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1 sm:hidden" aria-live="polite">
          {compactCues.map((c) => (
            <li key={c} className={clsx("rounded-full border px-2 py-0.5 text-[11px] font-semibold", c.startsWith("SW1:") ? "border-pv-border text-pv-text-muted" : c.includes("learned") ? "border-pv-success/50 bg-pv-success/10 text-pv-success" : "border-pv-warning/50 bg-pv-warning/10 text-pv-warning")}>
              {c}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
