import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface Srv6RepairSidRow {
  sid: string;
  owner: string;
  behavior: string;
  adjacency?: string;
  flavors: string[];
  purpose: string;
}

/**
 * SRv6 TI-LFA repair-path viewer — deliberately NOT a reuse of
 * `RepairListViewer`/`SegmentListViewer`, whose `sid: number` field is
 * an MPLS label and cannot represent an IPv6 SID string without
 * touching a component shared by /demo/mpls-rsvp-frr, /demo/sr-ti-lfa,
 * and /demo/l2vpn-evolution. Shows the repair path's TWO parts
 * explicitly — outgoing interface, then repair list — because a
 * TI-LFA repair path is never only a SID list. Purely a renderer; no
 * P-Space/Q-Space/repair computation lives here.
 */
export function Srv6RepairListViewer({
  title = "TI-LFA Repair Path",
  protectedResource,
  outgoingInterface,
  sids,
}: {
  title?: string;
  protectedResource: string;
  outgoingInterface?: string;
  sids: Srv6RepairSidRow[];
}) {
  return (
    <GlassPanel strong className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">{title}</h4>
        <Badge tone="danger">AVOIDS {protectedResource}</Badge>
      </div>

      <div className="rounded-lg border border-pv-cyan/30 bg-pv-cyan/5 p-2.5">
        <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Outgoing Interface</p>
        <p className="pv-mono text-xs text-pv-text">{outgoingInterface ?? "(none — no repair available)"}</p>
      </div>

      {sids.length === 0 ? (
        <p className="text-xs text-pv-text-faint">No repair SIDs installed.</p>
      ) : (
        <div className="space-y-1.5">
          {sids.map((s, i) => (
            <div key={s.sid} className="rounded-lg border border-pv-border p-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="pv-mono text-[10px] text-pv-text-faint">#{i + 1}</span>
                <span className="pv-mono font-semibold text-pv-text">{s.sid}</span>
                <Badge tone="cyan">{s.behavior}</Badge>
                {s.flavors.map((f) => (
                  <Badge key={f} tone="violet">
                    {f}
                  </Badge>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-3 pv-mono text-[10px] text-pv-text-muted">
                <span>owner: {s.owner}</span>
                {s.adjacency && <span>adjacency: {s.adjacency}</span>}
              </div>
              <p className="mt-1 text-[11px] text-pv-text-muted">{s.purpose}</p>
            </div>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}
