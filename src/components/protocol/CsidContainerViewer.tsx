import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface CsidSlot {
  /** Hex text for this slot, e.g. "0x0003", or "0000" for padding. */
  value: string;
  /** Owning router/segment label, undefined for zero padding. */
  owner?: string;
  role: "active" | "queued" | "padding";
}

export interface CsidContainerData {
  locatorBlockText: string;
  locatorBlockBits: number;
  csidBits: number;
  argumentBits: number;
  slots: CsidSlot[];
  /** For a REPLACE-CSID first container: the Index value instead of a queued-CSID row. */
  indexValue?: number;
  isPackedContainer?: boolean;
}

/**
 * Generic RFC 9800 CSID container viewer — Locator-Block, active CSID,
 * queued CSIDs, zero padding, and bit widths, one slot highlighted as
 * active. No compression/advance logic lives here; every slot and bit
 * width is handed in already computed by the scenario layer.
 */
export function CsidContainerViewer({ title = "CSID Container", data }: { title?: string; data: CsidContainerData }) {
  return (
    <GlassPanel className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title}</h4>
        {data.isPackedContainer && <Badge tone="warning">Packed — not a valid SID</Badge>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {!data.isPackedContainer && (
          <div className="rounded-lg border border-pv-cyan/40 bg-pv-cyan/10 px-2.5 py-2">
            <p className="text-[9px] uppercase tracking-wide text-pv-cyan-soft">Locator-Block /{data.locatorBlockBits}</p>
            <p className="pv-mono text-xs font-semibold text-pv-text">{data.locatorBlockText}</p>
          </div>
        )}
        {data.slots.map((slot, i) => (
          <div
            key={i}
            className={clsx(
              "rounded-lg border px-2.5 py-2",
              slot.role === "active" && "border-pv-violet bg-pv-violet/15",
              slot.role === "queued" && "border-pv-border bg-pv-bg-soft",
              slot.role === "padding" && "border-pv-border/50 opacity-50",
            )}
          >
            <p className="text-[9px] uppercase tracking-wide text-pv-text-faint">
              {slot.role === "active" ? "Active CSID" : slot.role === "padding" ? "Padding" : "Queued"} /{data.csidBits}
            </p>
            <p className="pv-mono text-xs font-semibold text-pv-text">{slot.value}</p>
            {slot.owner && <p className="text-[10px] text-pv-text-faint">{slot.owner}</p>}
          </div>
        ))}
        {data.indexValue !== undefined && (
          <div className="rounded-lg border border-pv-border bg-pv-bg-soft px-2.5 py-2">
            <p className="text-[9px] uppercase tracking-wide text-pv-text-faint">Index</p>
            <p className="pv-mono text-xs font-semibold text-pv-text">{data.indexValue}</p>
          </div>
        )}
      </div>
      {!data.isPackedContainer && <p className="mt-2 text-[10px] text-pv-text-faint">Argument field width: {data.argumentBits} bits — everything after the active CSID.</p>}
    </GlassPanel>
  );
}
