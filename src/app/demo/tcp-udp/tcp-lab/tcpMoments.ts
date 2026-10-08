import { TN_ADDR, pktName, tcpdumpFlags, type Pkt, type TcpState, type Tcb, type TnDev, type TnRun, type TnSnap } from "@/lib/sim-engine/scenarios/tcpNet";

/**
 * A test as the lab plays it: moments on the simulation's own clock. Everything that crosses a link in the same
 * millisecond moves in the same moment (a burst of segments pipelines across the path, an ACK passes data going the
 * other way), and every moment carries the sockets exactly as they were at its end — so the endpoint states on the
 * topology, the socket tables and the captures all agree with the packets on the wire. Long silences (a timer
 * running, a tool waiting) become one short "time passes" moment that says how long.
 */

export interface TcpCopy {
  from: TnDev;
  to: TnDev;
  pkt: Pkt;
  /** The packet died on arrival at `to` (why). */
  dropped?: string;
}
export interface TcpMoment {
  t: number;
  copies: TcpCopy[];
  /** What happened in this moment, in order. */
  lines: { text: string; tone: "info" | "ok" | "bad" | "state" }[];
  /** Sockets at the end of this moment. */
  snap: TnSnap;
  /** Milliseconds of silence before this moment (shown when long). */
  gap: number;
  /** A packet that never left a host (firewall OUTPUT, no route). */
  stuck?: { at: TnDev; text: string };
}
export const TCP_MOMENT_MS = 900;

export function tcpMoments(run: TnRun | undefined): TcpMoment[] {
  if (!run) return [];
  const out: TcpMoment[] = [];
  let prevT = run.start;
  let i = 0;
  const ev = run.events;
  while (i < ev.length) {
    const t = ev[i].t;
    const m: TcpMoment = { t, copies: [], lines: [], snap: run.snaps[i], gap: t - prevT };
    while (i < ev.length && ev[i].t === t) {
      const e = ev[i];
      if (e.k === "hop") m.copies.push({ from: e.from, to: e.to, pkt: e.pkt });
      else if (e.k === "drop") {
        if (e.at === "r1") m.copies.push({ from: e.pkt.src === TN_ADDR.laptop ? "laptop" : "server", to: "r1", pkt: e.pkt, dropped: e.why === "crc" ? "✕ CRC error" : e.why === "acl" ? "✕ ACL deny" : e.why === "lab-loss" ? "✕ lost" : "✕ dropped" });
        else if (e.why === "ipt" && m.copies.some((c) => c.to === e.at && c.pkt.id === e.pkt.id)) m.copies.find((c) => c.to === e.at && c.pkt.id === e.pkt.id)!.dropped = "✕ firewall";
        else m.stuck = { at: e.at, text: e.why === "no-route" ? "✕ no route" : "✕ firewall" };
        m.lines.push({ text: e.text, tone: "bad" });
      } else if (e.k === "state") m.lines.push({ text: `${e.host === "laptop" ? "Laptop" : "Server"} ${e.from} → ${e.to}: ${e.why}`, tone: "state" });
      else if (e.k === "note") m.lines.push({ text: e.text, tone: e.tone === "bad" ? "bad" : e.tone === "ok" ? "ok" : "info" });
      m.snap = run.snaps[i];
      i++;
    }
    // A packet arriving somewhere and processed: say what it was if nothing else explains it.
    for (const c of m.copies) if (!c.dropped && (c.to === "laptop" || c.to === "server") && !m.lines.length) m.lines.push({ text: `${c.to === "laptop" ? "Laptop" : "Server"} receives ${describe(c.pkt)}`, tone: "info" });
    for (const c of m.copies) if (c.to === "r1" && !c.dropped && !m.lines.length) m.lines.push({ text: `R1 forwards ${describe(c.pkt)} — it reads the IP header only, and keeps no TCP state`, tone: "info" });
    out.push(m);
    prevT = t;
  }
  return out;
}

export function describe(p: Pkt): string {
  if (p.proto === "tcp") {
    const h = p.tcp!;
    return `${p.retx ? "retransmitted " : ""}${pktName(p)} ${tcpdumpFlags(h.flags)} seq=${h.seq}${h.ack !== undefined ? ` ack=${h.ack}` : ""}${h.len ? ` len=${h.len}` : ""}`;
  }
  if (p.proto === "udp") return `${pktName(p)} (UDP ${p.udp!.sport} → ${p.udp!.dport}, ${p.udp!.len} bytes)`;
  return pktName(p);
}
/** Short marker label: what the segment is, and the numbers that matter for it. */
export function marker(p: Pkt): string {
  if (p.proto === "udp") return p.udp!.dport === 53 ? "DNS query" : "DNS answer";
  if (p.proto === "icmp") return p.icmp!.type === 3 ? "ICMP port unreachable" : p.icmp!.type === 8 ? "ping" : "ping reply";
  const h = p.tcp!;
  const name = pktName(p);
  const n = name === "data" ? `data ${h.len} B` : name;
  return `${p.retx ? "↻ " : ""}${n} seq=${h.seq}${h.ack !== undefined && name !== "SYN" ? ` ack=${h.ack}` : ""}`.replace(/ /g, " ");
}
export const MARKER_COLOR = (p: Pkt): string => {
  if (p.proto === "udp") return "#a78bfa";
  if (p.proto === "icmp") return "#f87171";
  const n = pktName(p);
  return p.retx ? "#fb923c" : n === "SYN" ? "#38bdf8" : n === "SYN-ACK" ? "#22d3ee" : n === "ACK" ? "#94a3b8" : n === "data" ? "#34d399" : n === "FIN" ? "#fbbf24" : n === "RST" ? "#f87171" : "#94a3b8";
};
/** The conversation this test is about, and each endpoint's state for it, at a moment. */
export function conversation(snap: TnSnap | undefined, runId: number, port?: number): { client?: Tcb; server?: Tcb } {
  if (!snap) return {};
  const client = [...snap.tcbs].reverse().find((t) => t.host === "laptop" && t.run === runId) ?? snap.tcbs.find((t) => t.host === "laptop" && t.remote?.port === port);
  const server = client ? snap.tcbs.find((t) => t.host === "server" && t.remote?.port === client.local.port) : undefined;
  return { client, server };
}
export const STATE_TONE: Record<TcpState, "muted" | "cyan" | "warn" | "ok" | "violet"> = { CLOSED: "muted", LISTEN: "cyan", "SYN-SENT": "warn", "SYN-RECEIVED": "warn", ESTABLISHED: "ok", "FIN-WAIT-1": "violet", "FIN-WAIT-2": "violet", "CLOSE-WAIT": "violet", CLOSING: "violet", "LAST-ACK": "violet", "TIME-WAIT": "violet" };
