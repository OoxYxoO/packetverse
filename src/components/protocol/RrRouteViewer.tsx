import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface RrRouteRow {
  prefix: string;
  originator: string;
  originatorId: string;
  nextHop: string;
  localPref: number;
  clusterList: string[];
  reflected?: boolean;
  learnedFromClient?: boolean;
}

/**
 * BGP route reflection viewer — shows a route's ORIGINATOR_ID and
 * CLUSTER_LIST alongside its ordinary path attributes, so the learner
 * can see exactly which fields a Route Reflector adds/reads that an
 * ordinary iBGP speaker never touches. Purely a renderer over data
 * the scenario layer computed — no reflection logic lives here.
 */
export function RrRouteViewer({ title, route }: { title: string; route: RrRouteRow | undefined }) {
  return (
    <GlassPanel className="p-4">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title} — BGP Route</h4>
      {!route ? (
        <p className="pv-mono text-xs text-pv-text-faint">EMPTY</p>
      ) : (
        <div className="space-y-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="pv-mono font-semibold text-pv-text">{route.prefix}</span>
            {route.learnedFromClient && <Badge tone="cyan">From Client</Badge>}
            {route.reflected && <Badge tone="success">Reflected</Badge>}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 pv-mono text-pv-text-muted">
            <span>
              Originator: <span className="text-pv-text">{route.originator}</span>
            </span>
            <span>
              Local Pref: <span className="text-pv-text">{route.localPref}</span>
            </span>
            <span className="col-span-2">
              Next Hop: <span className="text-pv-text">{route.nextHop}</span>
            </span>
            <span className="col-span-2">
              ORIGINATOR_ID: <span className="text-pv-cyan-soft">{route.originatorId}</span>
            </span>
            <span className="col-span-2">
              CLUSTER_LIST:{" "}
              <span className="text-pv-violet">{route.clusterList.length ? route.clusterList.join(", ") : "(empty — not yet reflected)"}</span>
            </span>
          </div>
        </div>
      )}
    </GlassPanel>
  );
}
