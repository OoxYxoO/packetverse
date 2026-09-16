import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface VpnRouteRow {
  vrf: string;
  prefix: string;
  originPe: string;
  rd?: string;
  rt?: string;
  nextHop?: string;
  vpnLabel?: number;
  received?: boolean;
  rtChecked?: boolean;
  imported?: boolean;
  /** Set only when this route has passed through a Route Reflector — the two fields an ordinary iBGP speaker never adds/reads. */
  originatorId?: string;
  clusterList?: string[];
}

/**
 * VPNv4 route viewer — shows a route's RD/RT/next-hop/VPN-label
 * alongside RECEIVED/RT-CHECKED/IMPORTED status flags, so the
 * learner can see exactly how far a route has progressed through
 * the MP-BGP control plane. Purely a renderer over data the
 * scenario layer computed — no import/RT logic lives here.
 */
export function VpnRouteViewer({ title, route }: { title: string; route: VpnRouteRow | undefined }) {
  return (
    <GlassPanel className="p-4">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title} — VPNv4 Route</h4>
      {!route ? (
        <p className="pv-mono text-xs text-pv-text-faint">EMPTY</p>
      ) : (
        <div className="space-y-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="pv-mono font-semibold text-pv-text">{route.prefix}</span>
            <Badge tone="muted">{route.vrf}</Badge>
            {route.received && <Badge tone="cyan">Received</Badge>}
            {route.rtChecked && <Badge tone={route.imported ? "success" : "danger"}>RT {route.imported ? "Matched" : "Mismatch"}</Badge>}
            {route.imported && <Badge tone="success">Imported</Badge>}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 pv-mono text-pv-text-muted">
            <span>
              Origin PE: <span className="text-pv-text">{route.originPe}</span>
            </span>
            {route.rd && (
              <span>
                RD: <span className="text-pv-cyan-soft">{route.rd}</span>
              </span>
            )}
            {route.rt && (
              <span>
                RT: <span className="text-pv-violet">{route.rt}</span>
              </span>
            )}
            {route.nextHop && (
              <span>
                Next Hop: <span className="text-pv-text">{route.nextHop}</span>
              </span>
            )}
            {route.vpnLabel !== undefined && (
              <span className="col-span-2">
                VPN Label: <span className="text-pv-text">{route.vpnLabel}</span>
              </span>
            )}
            {route.originatorId && (
              <span className="col-span-2">
                ORIGINATOR_ID: <span className="text-pv-cyan-soft">{route.originatorId}</span>
              </span>
            )}
            {route.clusterList && (
              <span className="col-span-2">
                CLUSTER_LIST: <span className="text-pv-violet">{route.clusterList.length ? route.clusterList.join(", ") : "(empty — not yet reflected)"}</span>
              </span>
            )}
          </div>
        </div>
      )}
    </GlassPanel>
  );
}

/** Side-by-side IPv4 → VPNv4 transformation, for the RD/RT teaching moments. */
export function VpnRouteTransform({ prefix, rd, rt, tone }: { prefix: string; rd?: string; rt?: string; tone?: "cyan" | "violet" }) {
  return (
    <div className={clsx("rounded-lg border px-3 py-2 pv-mono text-[11px]", tone === "violet" ? "border-pv-violet/40 bg-pv-violet/5" : "border-pv-cyan/40 bg-pv-cyan/5")}>
      {rd ? (
        <span>
          <span className={tone === "violet" ? "text-pv-violet" : "text-pv-cyan-soft"}>{rd}</span>
          <span className="text-pv-text-faint">:</span>
          <span className="text-pv-text">{prefix}</span>
        </span>
      ) : (
        <span className="text-pv-text">{prefix}</span>
      )}
      {rt && <span className="ml-3 text-pv-text-faint">RT {rt}</span>}
    </div>
  );
}
