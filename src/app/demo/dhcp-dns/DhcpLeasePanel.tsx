"use client";

import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { DH_ADDR, DNS_NAME, DNS_RECORD_TTL, type DhState } from "@/lib/sim-engine/scenarios/dhcpDns";
import { clientLeaseRows } from "./explain";

/** CLIENT lease + server scope + DNS state, from the SHOWN state (historical-aware). */
export function DhcpLeasePanel({ s }: { s: DhState }) {
  const drift = s.client.dns !== undefined && s.client.dns !== s.serverOption6;
  return (
    <GlassPanel className="space-y-3 p-4">
      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">CLIENT lease</p>
        <div className="space-y-0.5 text-[11px]">
          {clientLeaseRows(s).map((r) => (
            <div key={r.label} className="flex flex-wrap justify-between gap-x-3">
              <span className="text-pv-text-faint">{r.label}</span>
              <span className="pv-mono break-all text-right text-pv-text">{r.value}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-pv-border pt-2 text-[11px]">
        <div className="flex flex-wrap justify-between gap-x-3">
          <span className="text-pv-text-faint">DHCP-SRV Option 6</span>
          <span className="pv-mono text-pv-text">{s.serverOption6}</span>
        </div>
        {drift && <p className="mt-1 text-[10px] text-pv-warning">The server&apos;s Option 6 differs from the client&apos;s current lease; the client learns it only when it renews.</p>}
      </div>
      <DnsRecordPanel s={s} />
    </GlassPanel>
  );
}

export function DnsRecordPanel({ s }: { s: DhState }) {
  return (
    <div className="border-t border-pv-border pt-2 text-[11px]">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">DNS</p>
      <div className="flex flex-wrap justify-between gap-x-3">
        <span className="text-pv-text-faint">Record</span>
        <span className="pv-mono break-all text-right text-pv-text">
          {DNS_NAME} A {DH_ADDR.WEB} · {DNS_RECORD_TTL} s
        </span>
      </div>
      <div className="flex flex-wrap justify-between gap-x-3">
        <span className="text-pv-text-faint">Last query</span>
        <span className={clsx("pv-mono text-right", s.lastDns?.result === "no response" ? "text-pv-danger" : "text-pv-text")}>{s.lastDns ? `0x${s.lastDns.id.toString(16).toUpperCase()} → ${s.lastDns.server} · ${s.lastDns.result}` : "none"}</span>
      </div>
      <div className="flex flex-wrap justify-between gap-x-3">
        <span className="text-pv-text-faint">Client cache</span>
        <span className="pv-mono break-all text-right text-pv-text">{s.dnsCache.length ? s.dnsCache.map((c) => `${c.name} → ${c.address}`).join(", ") : "empty"}</span>
      </div>
    </div>
  );
}
