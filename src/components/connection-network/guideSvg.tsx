import type { ReactNode } from "react";

/** Shared SVG/HTML diagram primitives for guides drawn on the connection network (Laptop · SW1 · R1 · Server). */
export const C = {
  arp: "#f59e0b",
  eth: "#94a3b8",
  ip: "#60a5fa",
  tcp: "#34d399",
  tls: "#a78bfa",
  cyan: "#22d3ee",
  danger: "#fb7185",
  text: "#e8edf9",
  muted: "#8b96ac",
  faint: "#5b6478",
  box: "#121a2e",
  line: "#3a4460",
};

export function Device({ x, y, label, sub, accent = C.cyan, w = 104 }: { x: number; y: number; label: string; sub?: string; accent?: string; w?: number }) {
  return (
    <g>
      <rect x={x - w / 2} y={y - 22} width={w} height={44} rx={10} fill={C.box} stroke={accent} strokeOpacity={0.7} />
      <text x={x} y={sub ? y - 3 : y + 4} textAnchor="middle" fill={C.text} fontSize={12} fontWeight={600}>
        {label}
      </text>
      {sub && (
        <text x={x} y={y + 13} textAnchor="middle" fill={C.muted} fontSize={9.5} fontFamily="monospace">
          {sub}
        </text>
      )}
    </g>
  );
}

export function Arrow({ x1, y1, x2, y2, color, dashed, label, labelDy = -8, id }: { x1: number; y1: number; x2: number; y2: number; color: string; dashed?: boolean; label?: string; labelDy?: number; id: string }) {
  return (
    <g>
      <defs>
        <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={color} />
        </marker>
      </defs>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={2.2} strokeDasharray={dashed ? "5 4" : undefined} markerEnd={`url(#${id})`} />
      {label && (
        <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 + labelDy} textAnchor="middle" fill={color} fontSize={10} fontWeight={700}>
          {label}
        </text>
      )}
    </g>
  );
}

export function Svg({ h, children, label }: { h: number; children: ReactNode; label: string }) {
  return (
    <svg viewBox={`0 0 640 ${h}`} className="h-auto w-full" role="img" aria-label={label}>
      {children}
    </svg>
  );
}

export function HeaderField({ label, value, note, color, strong }: { label: string; value: string; note: string; color: string; strong?: boolean }) {
  return (
    <div className="flex-1 rounded-lg border p-2.5" style={{ borderColor: `${color}66`, background: strong ? `${color}14` : "transparent" }}>
      <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color }}>
        {label}
      </p>
      <p className="pv-mono mt-0.5 text-xs text-pv-text">{value}</p>
      <p className="mt-1 text-[10px] text-pv-text-faint">{note}</p>
    </div>
  );
}

/** The connection network both lessons use: Laptop and switch on the LAN, R1 between the two subnets, the Server behind it. */
export function ConnectionTopologyDiagram() {
  return (
    <Svg h={190} label="Laptop, switch and router on the LAN 192.168.10.0/24; router and server on the server segment 10.20.20.0/24">
      <rect x={14} y={30} width={400} height={130} rx={14} fill={C.cyan} fillOpacity={0.05} stroke={C.cyan} strokeOpacity={0.35} strokeDasharray="6 5" />
      <text x={28} y={50} fill={C.cyan} fontSize={10} fontWeight={700}>
        LAN 192.168.10.0/24
      </text>
      <rect x={430} y={30} width={196} height={130} rx={14} fill={C.tcp} fillOpacity={0.05} stroke={C.tcp} strokeOpacity={0.35} strokeDasharray="6 5" />
      <text x={444} y={50} fill={C.tcp} fontSize={10} fontWeight={700}>
        SERVER SEGMENT 10.20.20.0/24
      </text>
      <line x1={120} y1={100} x2={210} y2={100} stroke={C.line} strokeWidth={2} />
      <line x1={310} y1={100} x2={380} y2={100} stroke={C.line} strokeWidth={2} />
      <line x1={470} y1={100} x2={520} y2={100} stroke={C.line} strokeWidth={2} />
      <Device x={70} y={100} label="Laptop" sub="192.168.10.10" />
      <Device x={260} y={100} label="Switch" sub="Layer 2" accent={C.eth} />
      <Device x={425} y={100} label="Router" sub="gateway" accent={C.ip} w={96} />
      <Device x={570} y={100} label="Server" sub="10.20.20.20" accent={C.tcp} w={96} />
      <text x={392} y={140} fill={C.muted} fontSize={9} fontFamily="monospace" textAnchor="end">
        .1 (LAN side)
      </text>
      <text x={458} y={140} fill={C.muted} fontSize={9} fontFamily="monospace">
        .1 (server side)
      </text>
    </Svg>
  );
}
