import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

/**
 * Generic pseudowire signaling viewer — plain fields in, plain rows
 * out. Knows nothing about LDP, FEC matching, or label allocation;
 * every value is handed in already computed. Deliberately its own
 * shape (PW type/ID, directional labels, targeted-LDP + transport
 * state, control word) rather than reusing ServiceInstanceViewer,
 * since a pseudowire's directional-label model doesn't fit that
 * component's plain field-list shape well.
 */
export function PseudowireViewer({
  title = "Pseudowire",
  service,
  pwType,
  pwId,
  localPe,
  remotePe,
  localAc,
  remotePeer,
  localReceiveLabel,
  remoteReceiveLabel,
  transportState,
  targetedLdpState,
  pwState,
  mtu,
  controlWord,
  status,
}: {
  title?: string;
  service: string;
  pwType: string;
  pwId: number;
  localPe: string;
  remotePe: string;
  localAc: string;
  remotePeer: string;
  localReceiveLabel: number;
  remoteReceiveLabel?: number;
  transportState: string;
  targetedLdpState: string;
  pwState: "UP" | "DOWN";
  mtu: number;
  controlWord: boolean;
  status?: string;
}) {
  return (
    <GlassPanel strong className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">{title}</h4>
        <div className="flex gap-1.5">
          <Badge tone="cyan">{pwType.toUpperCase()}</Badge>
          <Badge tone={pwState === "UP" ? "success" : "danger"}>PW {pwState}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 pv-mono text-[11px]">
        <span className="text-pv-text-faint">Service</span>
        <span className="text-pv-text">{service}</span>
        <span className="text-pv-text-faint">PW ID</span>
        <span className="text-pv-text">{pwId}</span>
        <span className="text-pv-text-faint">Local PE</span>
        <span className="text-pv-text">{localPe}</span>
        <span className="text-pv-text-faint">Remote PE</span>
        <span className="text-pv-text">{remotePe}</span>
        <span className="text-pv-text-faint">Local AC</span>
        <span className="text-pv-text">{localAc}</span>
        <span className="text-pv-text-faint">Remote Peer</span>
        <span className="text-pv-text">{remotePeer}</span>
        <span className="text-pv-text-faint">MTU</span>
        <span className="text-pv-text">{mtu}</span>
        <span className="text-pv-text-faint">Control Word</span>
        <span className="text-pv-text">{controlWord ? "enabled" : "disabled"}</span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-pv-border pt-2 pv-mono text-[11px]">
        <span className="text-pv-text-faint">Local Receive Label</span>
        <span className="font-semibold text-pv-cyan-soft">{localReceiveLabel}</span>
        <span className="text-pv-text-faint">Remote Receive Label</span>
        <span className="font-semibold text-pv-cyan-soft">{remoteReceiveLabel ?? "not learned"}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-pv-border pt-2.5 pv-mono text-[11px]">
        <Badge tone={transportState === "UP" ? "success" : "muted"}>Transport {transportState}</Badge>
        <Badge tone={targetedLdpState === "OPERATIONAL" ? "success" : "muted"}>Targeted LDP {targetedLdpState}</Badge>
        {status && <span className="text-pv-text-muted">{status}</span>}
      </div>
    </GlassPanel>
  );
}
