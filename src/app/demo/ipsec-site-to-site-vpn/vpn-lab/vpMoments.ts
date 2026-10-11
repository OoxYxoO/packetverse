import type { CliVendor } from "@/lib/cli/types";
import type { VpDecision, VpDev, VpPkt, VpRun, VpRx } from "@/lib/sim-engine/scenarios/vpnNet";

/** A run as the VPN Lab plays it: one moment per wave (one hop of one packet). */
export interface VpMarker {
  from: VpDev;
  to: VpDev;
  pkt: VpPkt;
}
export interface VpMoment {
  k: number;
  markers: VpMarker[];
  decisions: VpDecision[];
  rx: VpRx[];
  lines: { text: string; tone: "info" | "ok" | "bad" | "learn" }[];
}
export const VP_MOMENT_MS = 1200;
export const VP_TRAVEL_MS = 800;
export function vpMoments(run: VpRun | undefined): VpMoment[] {
  if (!run) return [];
  return run.waves
    .filter((w) => w.hops.length || w.decisions.length || w.rx.length)
    .map((w) => {
      const lines: VpMoment["lines"] = [];
      for (const d of w.decisions) lines.push({ text: `${d.dev}: ${d.drop ? `DROPPED — ${d.drop}` : d.text}`, tone: d.drop ? "bad" : /→ ESP|decrypted/.test(d.text) ? "learn" : "info" });
      for (const r of w.rx) lines.push({ text: r.why, tone: r.ok ? "ok" : "bad" });
      return { k: w.k, markers: w.hops.map((h) => ({ from: h.from, to: h.to, pkt: h.pkt })), decisions: w.decisions, rx: w.rx, lines };
    });
}
export function markerLabel(m: VpMarker, compact: boolean): string {
  const p = m.pkt;
  const t = p.kind === "esp" ? (compact ? "ESP" : `ESP ${p.spi} #${p.espSeq}`) : p.kind === "ike" ? (compact ? "IKE" : `${p.ike!.ex} ${p.ike!.resp ? "resp" : "req"}${p.ike!.notify ? ` ${p.ike!.notify}` : ""}`) : compact ? (p.icmp === "echo" ? "ping" : "reply") : `${p.icmp === "echo" ? "ping" : "reply"} ${p.src} → ${p.dst}`;
  return t.replace(/ /g, " ");
}
export function markerColor(m: VpMarker): string {
  const p = m.pkt;
  if (p.kind === "esp") return "#f472b6";
  if (p.kind === "ike") return p.ike?.notify ? "#f87171" : "#a78bfa";
  return p.icmp === "echo" ? "#22d3ee" : "#34d399";
}
export function fateOf(m: VpMoment, mk: VpMarker): { text: string; tone: "ok" | "bad" | "muted" } | undefined {
  const r = m.rx.find((x) => x.dev === mk.to && x.pkt.id === mk.pkt.id);
  if (r) return r.ok ? { text: "✓", tone: "ok" } : { text: "✕", tone: "bad" };
  const d = m.decisions.find((x) => x.dev === mk.to && x.pkt.id === mk.pkt.id);
  if (d?.drop) return { text: "✕ dropped", tone: "bad" };
  return undefined;
}
/** Interface names: Cisco Gi0/0 LAN, Gi0/1 WAN · Junos ge-0/0/0 LAN, ge-0/0/1 WAN, st0.0 the tunnel interface. */
export const vpIf = (vendor: CliVendor, side: "lan" | "wan", long = false) => (vendor === "cisco" ? `${long ? "GigabitEthernet" : "Gi"}0/${side === "lan" ? 0 : 1}` : `ge-0/0/${side === "lan" ? 0 : 1}`);
