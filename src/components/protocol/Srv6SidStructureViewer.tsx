import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface Srv6SidStructureProps {
  title?: string;
  /** Full 128-bit SID in compressed text form, e.g. "2001:db8:100:3:1::" */
  sid: string;
  locatorLength: number;
  functionLength: number;
  argumentLength: number;
  /** Locator prefix in text form, e.g. "2001:db8:100:3::/64" */
  locator: string;
  /** Function value in text form, e.g. "0x0001" */
  functionText: string;
  /** Argument value in text form — omitted entirely when argumentLength is 0. */
  argumentText?: string;
  behavior: string;
  owner?: string;
}

/**
 * Generic SRv6 SID decomposition viewer (LOC:FUNCT:ARG, RFC 8986) — every
 * value is handed in already computed by the scenario layer. Renders no
 * protocol semantics of its own; it never calculates a locator, a
 * function, or a behavior binding.
 */
export function Srv6SidStructureViewer({ title = "SRv6 SID Structure", sid, locatorLength, functionLength, argumentLength, locator, functionText, argumentText, behavior, owner }: Srv6SidStructureProps) {
  return (
    <GlassPanel className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title}</h4>
        <span className="pv-mono text-[10px] text-pv-text-faint">
          LOC/{locatorLength} · FUNCT/{functionLength} · ARG/{argumentLength}
        </span>
      </div>

      <p className="pv-mono mb-3 break-all text-sm font-bold text-pv-text">{sid}</p>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-pv-cyan/30 bg-pv-cyan/5 p-2.5">
          <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Locator</p>
          <p className="pv-mono text-xs text-pv-text">{locator}</p>
          <p className="mt-1 text-[10px] text-pv-text-faint">Ordinary IPv6 forwarding toward the owner.</p>
        </div>
        <div className="rounded-lg border border-pv-violet/30 bg-pv-violet/5 p-2.5">
          <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-pv-violet">Function</p>
          <p className="pv-mono text-xs text-pv-text">{functionText}</p>
          <p className="mt-1 text-[10px] text-pv-text-faint">Identifies the local instruction bound to this SID.</p>
        </div>
        <div className="rounded-lg border border-pv-border p-2.5">
          <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-pv-text-faint">Argument</p>
          <p className="pv-mono text-xs text-pv-text">{argumentLength === 0 ? "(none — ARG length 0)" : (argumentText ?? "—")}</p>
          <p className="mt-1 text-[10px] text-pv-text-faint">Optional, behavior-defined — not every SID has one.</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-pv-border pt-3">
        <span className="text-[10px] uppercase tracking-wide text-pv-text-faint">Behavior</span>
        <Badge tone="cyan">{behavior}</Badge>
        {owner && (
          <>
            <span className="text-[10px] uppercase tracking-wide text-pv-text-faint">Owner</span>
            <span className="pv-mono text-xs text-pv-text">{owner}</span>
          </>
        )}
      </div>
    </GlassPanel>
  );
}
