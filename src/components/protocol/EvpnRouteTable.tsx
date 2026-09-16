import { useState } from "react";
import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface EvpnMacRow {
  mac: string;
  ip: string;
  vni: number;
  /** How this leaf learned the entry — drives the Local/Remote/Assumed badge, never protocol logic. */
  source: "local" | "evpn" | "assumed";
  remoteVtep?: string;
  rd?: string;
  rt?: string;
}

/**
 * EVPN MAC/IP table viewer (brief §13) — MAC/IP/VNI/remote-VTEP/RD/RT,
 * with local vs. remote (and "assumed", for the pre-EVPN walkthrough)
 * clearly distinguished. Purely a renderer over rows the scenario
 * layer computed — no import/RT logic lives here.
 */
export function EvpnRouteTable({ title, rows }: { title: string; rows: EvpnMacRow[] }) {
  return (
    <GlassPanel className="p-4">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title} — EVPN / MAC Table</h4>
      {rows.length === 0 ? (
        <p className="pv-mono text-xs text-pv-text-faint">EMPTY</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.mac} className="rounded-lg border border-pv-border p-2.5 text-[11px]">
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <span className="pv-mono font-semibold text-pv-text">{r.mac}</span>
                <span className="pv-mono text-pv-text-faint">{r.ip}</span>
                <Badge tone="muted">VNI {r.vni}</Badge>
                {r.source === "local" && <Badge tone="success">Local</Badge>}
                {r.source === "evpn" && <Badge tone="cyan">Remote — EVPN</Badge>}
                {r.source === "assumed" && <Badge tone="warning">Remote — assumed (not yet explained)</Badge>}
              </div>
              <div className={clsx("grid grid-cols-2 gap-x-3 gap-y-0.5 pv-mono text-pv-text-muted", !r.remoteVtep && !r.rd && !r.rt && "hidden")}>
                {r.remoteVtep && (
                  <span>
                    Remote VTEP: <span className="text-pv-text">{r.remoteVtep}</span>
                  </span>
                )}
                {r.rd && (
                  <span>
                    RD: <span className="text-pv-cyan-soft">{r.rd}</span>
                  </span>
                )}
                {r.rt && (
                  <span>
                    RT: <span className="text-pv-violet">{r.rt}</span>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}

// ---------------------------------------------------------------------------
// Generic mixed-route-type RIB viewer — Type 2 / Type 3 / Type 5 (and any
// future EVPN route type) side by side, filterable, never relying on color
// alone to distinguish a route's kind (each row carries its own text label —
// "HOST" / "VNI" / "PREFIX" — brief: "Do not rely only on color").
// ---------------------------------------------------------------------------

export type EvpnRouteKind = "1" | "2" | "3" | "4" | "5";

export interface EvpnRibRow {
  routeType: EvpnRouteKind;
  /** The route's own identity — a "MAC / IP", a leaf label, or a prefix. */
  summary: string;
  nextHop: string;
  rd?: string;
  rt?: string;
  extra?: { label: string; value: string }[];
  /** Optional sub-form of this same route type (e.g. "PER EVI" vs "PER ES" for Type 1) — never a different route-type number. When 2+ distinct values are present for the active type filter, a secondary data-driven filter row appears automatically. */
  subKind?: string;
}

const ROUTE_KIND_LABEL: Record<EvpnRouteKind, string> = { "1": "ETHERNET A-D", "2": "MAC/IP", "3": "IMET", "4": "ETHERNET SEGMENT", "5": "IP PREFIX" };
const ROUTE_KIND_TONE: Record<EvpnRouteKind, "cyan" | "violet" | "success" | "warning" | "muted"> = { "1": "muted", "2": "cyan", "3": "violet", "4": "warning", "5": "success" };
const ROUTE_KIND_QUESTION: Record<EvpnRouteKind, string> = {
  "1": "Advertise Ethernet-Segment-related reachability/state.",
  "2": "Where is this MAC/IP endpoint?",
  "3": "Who participates in this VNI/BUM domain?",
  "4": "Who else is attached to this Ethernet Segment?",
  "5": "Where is this IP prefix?",
};

/**
 * Generic enough for any future lesson: pass whatever mix of Type
 * 1/2/3/4/5 rows exist right now, this renders one filterable table
 * over them. No route-type-specific import/RT/LPM/DF logic lives
 * here — purely a renderer.
 */
export function EvpnRibViewer({ title, rows }: { title: string; rows: EvpnRibRow[] }) {
  const [filter, setFilter] = useState<"all" | EvpnRouteKind>("all");
  const [subFilter, setSubFilter] = useState<string>("all");
  const typeFiltered = filter === "all" ? rows : rows.filter((r) => r.routeType === filter);
  const subKinds = Array.from(new Set(typeFiltered.map((r) => r.subKind).filter((s): s is string => Boolean(s))));
  const visible = subFilter === "all" ? typeFiltered : typeFiltered.filter((r) => r.subKind === subFilter);

  return (
    <GlassPanel className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title} — EVPN Routes</h4>
        <div className="flex gap-1 rounded-full border border-pv-border p-0.5">
          {(["all", "1", "2", "3", "4", "5"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => {
                setFilter(f);
                setSubFilter("all");
              }}
              className={clsx("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase transition-colors", filter === f ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}
            >
              {f === "all" ? "All" : `Type ${f}`}
            </button>
          ))}
        </div>
      </div>
      {subKinds.length > 1 && (
        <div className="mb-2 flex gap-1 rounded-full border border-pv-border p-0.5 w-fit">
          {["all", ...subKinds].map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setSubFilter(f)}
              className={clsx("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase transition-colors", subFilter === f ? "bg-pv-violet/15 text-pv-violet" : "text-pv-text-faint hover:text-pv-text")}
            >
              {f === "all" ? "All Forms" : f}
            </button>
          ))}
        </div>
      )}
      {visible.length === 0 ? (
        <p className="pv-mono text-xs text-pv-text-faint">EMPTY</p>
      ) : (
        <div className="space-y-2">
          {visible.map((r, i) => (
            <div key={r.summary + i} className="rounded-lg border border-pv-border p-2.5 text-[11px]" title={ROUTE_KIND_QUESTION[r.routeType]}>
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <Badge tone={ROUTE_KIND_TONE[r.routeType]}>
                  Type {r.routeType} · {ROUTE_KIND_LABEL[r.routeType]}
                </Badge>
                {r.subKind && <Badge tone="muted">{r.subKind}</Badge>}
                <span className="pv-mono font-semibold text-pv-text">{r.summary}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 pv-mono text-pv-text-muted">
                <span>
                  Next Hop: <span className="text-pv-text">{r.nextHop}</span>
                </span>
                {r.rd && (
                  <span>
                    RD: <span className="text-pv-cyan-soft">{r.rd}</span>
                  </span>
                )}
                {r.rt && (
                  <span>
                    RT: <span className="text-pv-violet">{r.rt}</span>
                  </span>
                )}
                {r.extra?.map((f) => (
                  <span key={f.label}>
                    {f.label}: <span className="text-pv-text">{f.value}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}
