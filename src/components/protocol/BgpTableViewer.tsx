import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";
import { AsPathTrail } from "./AsPathTrail";

export interface BgpPathRow {
  id: string;
  label: string;
  nextHop: string;
  localPref: number;
  asPath: number[];
  med?: number;
  origin: string;
  peerType: "eBGP" | "iBGP";
  valid: boolean;
  best: boolean;
  installed: boolean;
  nextHopReachable: boolean;
}

interface BgpTableViewerProps {
  title: string;
  prefix: string;
  paths: BgpPathRow[];
  onHoverAs?: (as: number | null) => void;
  highlightedAs?: number | null;
}

/**
 * BGP table viewer (brief §8) — deliberately distinguishes RECEIVED,
 * VALID, BEST and INSTALLED as separate concepts instead of implying
 * every received path becomes an installed route. Every field here
 * comes from the scenario's `BgpPath` state; no path comparison
 * happens in this component.
 */
export function BgpTableViewer({ title, prefix, paths, onHoverAs, highlightedAs }: BgpTableViewerProps) {
  return (
    <GlassPanel className="p-4">
      <div className="mb-1 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title}</h4>
        <span className="pv-mono text-[10px] text-pv-text-faint">{prefix}</span>
      </div>
      {paths.length === 0 ? (
        <p className="pv-mono text-xs text-pv-text-faint">EMPTY</p>
      ) : (
        <div className="space-y-2">
          {paths.map((p) => (
            <div
              key={p.id}
              className={clsx(
                "rounded-lg border p-2.5 text-[11px]",
                p.best ? "border-pv-success/40 bg-pv-success/5" : "border-pv-border",
              )}
            >
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <span className="pv-mono font-semibold text-pv-text">{p.label}</span>
                <Badge tone="muted">Received</Badge>
                {p.valid && <Badge tone="cyan">Valid</Badge>}
                {p.best && <Badge tone="success">Best</Badge>}
                {p.installed && <Badge tone={p.nextHopReachable ? "success" : "danger"}>Installed</Badge>}
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 pv-mono text-pv-text-muted">
                <span>
                  Next Hop: <span className={p.nextHopReachable ? "text-pv-text" : "text-pv-danger"}>{p.nextHop}</span>
                </span>
                <span>
                  Local Pref: <span className="text-pv-text">{p.localPref}</span>
                </span>
                <span className="col-span-2">
                  AS Path: <AsPathTrail asPath={p.asPath} onHoverAs={onHoverAs} highlighted={highlightedAs} />
                </span>
                <span>
                  MED: <span className="text-pv-text">{p.med ?? "—"}</span>
                </span>
                <span>
                  Origin: <span className="text-pv-text">{p.origin}</span>
                </span>
                <span className="col-span-2">
                  Peer Type: <span className="text-pv-text">{p.peerType}</span>
                </span>
              </div>
              {p.installed && !p.nextHopReachable && (
                <p className="mt-1.5 rounded border border-pv-danger/40 bg-pv-danger/10 px-2 py-1 text-pv-danger">
                  NEXT_HOP unreachable — route is installed but not usable.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}
