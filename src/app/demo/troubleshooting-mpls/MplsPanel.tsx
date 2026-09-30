"use client";

import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { CUST, LDP_LABEL, LDP_SESSIONS, LOOP, VRF, VRF_IMPORT, importable, vpnKey, vrfLookup, type MpState } from "@/lib/sim-engine/scenarios/troubleshootingMpls";

/** Plane-by-plane evidence at the SHOWN step: transport, VPN control plane, VRF and data-plane result. */
export function MplsPanel({ s }: { s: MpState }) {
  const rx = s.pe1Vpnv4.filter((r) => r.from === "PE2");
  const vrfHit = vrfLookup(s.pe1Vrf, CUST.ce2);
  const row = (label: string, value: string, ok: boolean | undefined) => (
    <div className="flex flex-wrap justify-between gap-x-2 pv-mono text-[10.5px]">
      <span className="text-pv-text">{label}</span>
      <span className={clsx("min-w-0 break-words text-right", ok === undefined ? "text-pv-text-muted" : ok ? "text-pv-success" : "text-pv-warning")}>{value}</span>
    </div>
  );
  return (
    <GlassPanel className="space-y-3 p-4 text-[11px]">
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Transport plane</p>
        {row(`IGP ${LOOP.PE1} → ${LOOP.PE2}`, "reachable", true)}
        {row("LDP sessions", LDP_SESSIONS.map((l) => `${l.a}–${l.b}`).join(" · ") + " Operational", true)}
        {row(`PE1 FEC ${LOOP.PE2}/32`, `push ${LDP_LABEL.toPE2.P1}`, true)}
      </div>
      <div className="border-t border-pv-border pt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">VPN control plane (PE1)</p>
        {row("MP-BGP PE1 ↔ PE2", s.bgp, true)}
        {rx.length === 0 ? row("VPNv4 from PE2", "none yet", undefined) : rx.map((r) => <div key={vpnKey(r)}>{row(vpnKey(r), `label ${r.label} · RT ${r.rts.join(",")}`, undefined)}</div>)}
        {row(`${VRF} import RT`, VRF_IMPORT.join(", "), undefined)}
      </div>
      <div className="border-t border-pv-border pt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">VRF {VRF} on PE1</p>
        {rx.length > 0 && row("Received route imported?", importable(rx[0]) ? "yes" : "no", importable(rx[0]))}
        {row(`lookup ${CUST.ce2}`, vrfHit ? `${vrfHit.prefix}/${vrfHit.len} ${vrfHit.source === "imported" ? `VPN ${vrfHit.vpnLabel} + LDP ${vrfHit.transport}` : vrfHit.via}` : "no route", vrfHit?.source === "imported")}
      </div>
      <div className="border-t border-pv-border pt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Data plane</p>
        {s.pings.length === 0 ? <p className="text-pv-text-faint">Not run yet.</p> : s.pings.map((p, i) => <div key={i}>{row(`${p.label}: ${p.from} → ${p.to}`, `${p.received}/${p.sent}`, p.received === p.sent)}</div>)}
        {row(`PE1 ${VRF} no-route drops`, String(s.pe1VrfDrops), s.pe1VrfDrops === 0 ? undefined : false)}
      </div>
    </GlassPanel>
  );
}
