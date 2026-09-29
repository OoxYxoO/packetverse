"use client";

import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { IKE_SPI_I, VPN, spiText, type VpnState } from "@/lib/sim-engine/scenarios/ipsecVpn";

/** IKE SA and CHILD SA side by side, plus GW-B's selector config — from the SHOWN state (historical-aware). */
export function VpnSaPanel({ s }: { s: VpnState }) {
  const c = s.child;
  const installed = !!c && s.childStatus === "INSTALLED";
  return (
    <GlassPanel className="space-y-3 p-4 text-[11px]">
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-violet">IKE SA · control plane (UDP/500)</p>
        <Row k="State" v={s.ike.phase} tone={s.ike.phase === "ESTABLISHED" ? "text-pv-success" : s.ike.phase === "NONE" ? "text-pv-text-faint" : "text-pv-warning"} />
        <Row k="SPIi / SPIr" v={s.ike.phase === "NONE" ? "—" : `${IKE_SPI_I} / ${s.ike.spiR ?? "0 (unknown)"}`} />
        <Row k="Peers authenticated" v={s.ike.peersAuthenticated ? "yes" : "no"} />
        <Row k="Latest exchange" v={s.ike.lastExchange ? `${s.ike.lastExchange} · MsgID ${s.ike.lastMsgId}` : "none"} />
      </div>
      <div className="border-t border-pv-border pt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">CHILD SA · data plane (ESP, protocol 50)</p>
        <Row k="State" v={s.childStatus} tone={installed ? "text-pv-success" : s.childStatus.startsWith("FAILED") ? "text-pv-danger" : "text-pv-text-faint"} />
        {installed ? (
          <>
            <Row k="TSi ↔ TSr" v={`${c!.tsi} ↔ ${c!.tsr}`} />
            <Row k="GW-A → GW-B SPI" v={`${spiText(c!.ab)} · next seq ${c!.seqAB}`} />
            <Row k="GW-B → GW-A SPI" v={`${spiText(c!.ba)} · next seq ${c!.seqBA}`} />
            <Row k="Anti-replay highest" v={`GW-B ${c!.rxAB} · GW-A ${c!.rxBA}`} />
          </>
        ) : (
          <p className="text-pv-text-faint">{s.childStatus === "DELETING" ? "INFORMATIONAL Delete in progress — the ESP SA pair is being removed." : "No ESP SAs — protected traffic cannot be sent."}</p>
        )}
        {s.lastNotify && <Row k="Last notify" v={s.lastNotify} tone="text-pv-danger" />}
      </div>
      <div className="border-t border-pv-border pt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Configured selectors</p>
        <Row k="GW-A local ↔ remote" v={`${VPN.siteA} ↔ ${VPN.siteB}`} />
        <Row k="GW-B local ↔ remote" v={`${VPN.siteB} ↔ ${s.gwbRemote}`} tone={s.gwbRemote !== VPN.siteA ? "text-pv-warning" : undefined} />
      </div>
      <p className="border-t border-pv-border pt-2 text-[10px] text-pv-text-faint">The SPI in an ESP packet is the one the receiver chose. Sequence numbers are per SA.</p>
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
