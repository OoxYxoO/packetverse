"use client";

import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { FW, NAT_RULE, tupleText, type FwState } from "@/lib/sim-engine/scenarios/firewallStateful";

/** FW1's NAT rule, session table, latest decision and deny log — from the SHOWN state (historical-aware). */
export function FirewallSessionPanel({ s }: { s: FwState }) {
  const badNat = s.natAddr !== FW.untrust;
  return (
    <GlassPanel className="space-y-3 p-4 text-[11px]">
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">FW1 · {NAT_RULE.name}</p>
        <Row k="Match" v={`${NAT_RULE.from} → ${NAT_RULE.to} · src ${NAT_RULE.source}`} />
        <Row k="Translate source to" v={`${s.natAddr} (PAT from 40001)`} tone={badNat ? "text-pv-warning" : undefined} />
      </div>
      <div className="border-t border-pv-border pt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Session table</p>
        {s.sessions.length === 0 ? (
          <p className="text-pv-text-faint">{s.closedNote ? `Empty (${s.closedNote})` : "Empty"}</p>
        ) : (
          s.sessions.map((x) => (
            <div key={x.id} className="mb-2 space-y-0.5 last:mb-0">
              <div className="flex flex-wrap justify-between gap-x-2">
                <span className="pv-mono font-semibold text-pv-text">#{x.id} · TCP · {x.ingressZone}→{x.egressZone}</span>
                <span className={clsx("pv-mono font-semibold", x.state === "ESTABLISHED" ? "text-pv-success" : "text-pv-warning")}>{x.state}</span>
              </div>
              <Row k="Original" v={`${tupleText(x.origSrc, x.origSport)} → ${tupleText(x.origDst, x.dport)}`} />
              <Row k="Translated src" v={tupleText(x.xlSrc, x.xlSport)} />
              <Row k="Policy · NAT" v={`${x.policy} · ${x.nat}`} />
              <Row k="Pkts / bytes out·in" v={`${x.pktsOut}/${x.bytesOut} · ${x.pktsIn}/${x.bytesIn}`} />
            </div>
          ))
        )}
      </div>
      {s.check && (
        <div className="border-t border-pv-border pt-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">FW1 latest decision</p>
          <Row k="Packet" v={s.check.packet} />
          <Row k="Session" v={s.check.session} />
          <Row k="Policy" v={s.check.policy} />
          <Row k="NAT" v={s.check.nat} />
          <Row k="Action" v={s.check.verdict} tone={s.check.verdict === "DROP" ? "text-pv-danger" : "text-pv-success"} />
        </div>
      )}
      {s.denyLog.length > 0 && (
        <div className="border-t border-pv-border pt-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-danger">Deny log</p>
          {s.denyLog.map((d, i) => (
            <Row key={i} k={`${tupleText(d.src, d.sport)} → ${tupleText(d.dst, d.dport)}`} v={d.reason} />
          ))}
        </div>
      )}
    </GlassPanel>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-3">
      <span className="text-pv-text-faint">{k}</span>
      <span className={clsx("pv-mono break-all text-right", tone ?? "text-pv-text")}>{v}</span>
    </div>
  );
}
