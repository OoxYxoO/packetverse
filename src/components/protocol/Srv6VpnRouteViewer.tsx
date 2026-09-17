import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface Srv6VpnRouteRow {
  afiSafi: string;
  prefix: string;
  rd?: string;
  routeTargets?: string;
  bgpNextHop?: string;
  serviceSid?: string;
  endpointBehavior?: string;
  sidAllocationMode?: string;
  received?: boolean;
  rtImported?: boolean;
  rtImportReason?: string;
  sidResolved?: boolean;
  sidResolvedReason?: string;
  installed?: boolean;
}

/**
 * SRv6 L3VPN route viewer (RFC 9252) — deliberately keeps four
 * independent status flags (received / RT imported / SID resolved /
 * installed) rather than one collapsed boolean, and keeps the BGP Next
 * Hop and the Service SID as two visually separate fields so they are
 * never mistaken for the same thing. Purely a renderer over data the
 * scenario layer computed — no import/resolution logic lives here.
 */
export function Srv6VpnRouteViewer({ title, route }: { title: string; route: Srv6VpnRouteRow | undefined }) {
  return (
    <GlassPanel className="p-4">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title} — SRv6 VPN Route</h4>
      {!route ? (
        <p className="pv-mono text-xs text-pv-text-faint">EMPTY</p>
      ) : (
        <div className="space-y-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="pv-mono font-semibold text-pv-text">{route.prefix}</span>
            <Badge tone="muted">{route.afiSafi}</Badge>
            {route.received && <Badge tone="cyan">Received</Badge>}
            {route.rtImported !== undefined && <Badge tone={route.rtImported ? "success" : "danger"}>RT {route.rtImported ? "Imported" : "Rejected"}</Badge>}
            {route.sidResolved !== undefined && <Badge tone={route.sidResolved ? "success" : "danger"}>SID {route.sidResolved ? "Resolved" : "Unresolvable"}</Badge>}
            {route.installed !== undefined && <Badge tone={route.installed ? "success" : "muted"}>{route.installed ? "Installed" : "Not Installed"}</Badge>}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 pv-mono text-pv-text-muted">
            {route.rd && (
              <span>
                RD: <span className="text-pv-cyan-soft">{route.rd}</span>
              </span>
            )}
            {route.routeTargets && (
              <span>
                RT: <span className="text-pv-violet">{route.routeTargets}</span>
              </span>
            )}
            {route.bgpNextHop && (
              <span className="col-span-2">
                BGP Next Hop: <span className="text-pv-text">{route.bgpNextHop}</span>
              </span>
            )}
          </div>
          {route.serviceSid && (
            <div className="rounded-lg border border-pv-cyan/30 bg-pv-cyan/5 p-2 pv-mono">
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Prefix-SID Attribute → SRv6 L3 Service TLV (Type 5)</p>
              <p className="text-pv-text">
                Service SID: <span className="text-pv-cyan-soft">{route.serviceSid}</span>
              </p>
              {route.endpointBehavior && (
                <p className="text-pv-text-muted">
                  Endpoint Behavior: <span className="text-pv-text">{route.endpointBehavior}</span>
                </p>
              )}
              {route.sidAllocationMode && (
                <p className="text-pv-text-muted">
                  SID Allocation: <span className="text-pv-text">{route.sidAllocationMode}</span>
                </p>
              )}
            </div>
          )}
          {(route.rtImportReason || route.sidResolvedReason) && (
            <div className="space-y-1 text-pv-text-faint">
              {route.rtImportReason && <p>{route.rtImportReason}</p>}
              {route.sidResolvedReason && <p>{route.sidResolvedReason}</p>}
            </div>
          )}
        </div>
      )}
    </GlassPanel>
  );
}
