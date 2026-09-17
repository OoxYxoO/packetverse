import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface SrhSegmentRow {
  /** Storage index inside Segment List[], 0 = the FINAL segment (RFC 8754) — never reordered as processing advances. */
  index: number;
  sid: string;
  label?: string;
}

export interface SegmentRoutingHeaderData {
  nextHeader: string;
  hdrExtLen: number;
  routingType: number;
  segmentsLeft: number;
  lastEntry: number;
  flags: string;
  tag: number;
  /** Storage order — Segment List[0] is the FINAL segment, never the first hop. */
  segmentList: SrhSegmentRow[];
}

interface SegmentRoutingHeaderViewerProps {
  title?: string;
  /** The current IPv6 Destination Address — the actual active segment. */
  activeDa: string;
  srh?: SegmentRoutingHeaderData;
}

/**
 * Generic SRH viewer (RFC 8754). Deliberately keeps the IPv6
 * Destination Address — the real active segment — visually separate
 * from the Segment List rows below it: a row is marked "= CURRENT DA"
 * only because it happens to match the DA right now, never because it
 * carries some stored "active" flag of its own. No SID/SRH processing
 * logic lives here — every field is handed in already computed.
 */
export function SegmentRoutingHeaderViewer({ title = "IPv6 Header + Segment Routing Header", activeDa, srh }: SegmentRoutingHeaderViewerProps) {
  return (
    <GlassPanel className="p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title}</h4>

      <div className="mb-3 rounded-lg border border-pv-ipv6/40 bg-pv-ipv6/5 p-3">
        <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-pv-text-faint">IPv6 Destination Address — the active segment</p>
        <p className="pv-mono break-all text-sm font-bold text-pv-text">{activeDa}</p>
      </div>

      {!srh ? (
        <p className="text-xs text-pv-text-faint">No SRH present on this packet — a single-segment policy needs no extension header.</p>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1.5 pv-mono text-[11px] sm:grid-cols-3">
            <Field label="Next Header" value={srh.nextHeader} />
            <Field label="Hdr Ext Len" value={String(srh.hdrExtLen)} />
            <Field label="Routing Type" value={`${srh.routingType} (SRH)`} />
            <Field label="Segments Left" value={String(srh.segmentsLeft)} highlight />
            <Field label="Last Entry" value={String(srh.lastEntry)} />
            <Field label="Flags" value={srh.flags} />
            <Field label="Tag" value={String(srh.tag)} />
          </div>

          <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-pv-text-faint">Segment List — storage order, index 0 = final segment</p>
          <div className="space-y-1">
            {srh.segmentList.map((s) => {
              const isCurrentDa = s.sid === activeDa;
              return (
                <div
                  key={s.index}
                  className={clsx("flex flex-wrap items-center gap-2 rounded-lg border px-3 py-1.5 text-xs", isCurrentDa ? "border-pv-cyan/50 bg-pv-cyan/10" : "border-pv-border")}
                >
                  <span className="pv-mono text-[10px] text-pv-text-faint">Segment List[{s.index}]</span>
                  <span className="pv-mono break-all font-semibold text-pv-text">{s.sid}</span>
                  {s.label && <span className="text-[10px] text-pv-text-faint">({s.label})</span>}
                  {isCurrentDa && <Badge tone="cyan">= CURRENT DA</Badge>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </GlassPanel>
  );
}

function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wide text-pv-text-faint">{label}</p>
      <p className={clsx(highlight ? "font-bold text-pv-cyan-soft" : "text-pv-text")}>{value}</p>
    </div>
  );
}
