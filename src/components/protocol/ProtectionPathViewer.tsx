import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

/**
 * Generic local-protection summary card — primary path vs. a backup
 * path, with the protected resource, PLR, and Merge Point called out.
 * Knows nothing about RSVP-TE, FRR, or MPLS; built for this lesson's
 * link/node protection, but the same shape fits IGP loop-free
 * alternates, SR-TE protection, or any other "primary path + a
 * pre-established detour around one resource" concept later.
 */
export function ProtectionPathViewer({
  title,
  primaryPath,
  backupPath,
  backupPathLabel = "Bypass Path",
  protectedResource,
  plr,
  plrLabel = "PLR",
  mergePoint,
  mergePointLabel = "MP",
  mergePointTitle = "Merge Point",
  protectionType,
  readiness,
  active,
  failure,
}: {
  title: string;
  primaryPath: string[];
  backupPath?: string[];
  /** Section heading over the backup path — defaults to "Bypass Path" (RSVP-TE FRR); pass e.g. "Repair Path" for an SR repair segment list. */
  backupPathLabel?: string;
  protectedResource: string;
  plr: string;
  /** Badge text on the PLR hop — defaults to "PLR" (a term shared by RSVP FRR and TI-LFA). */
  plrLabel?: string;
  mergePoint?: string;
  /** Badge text on the mergePoint hop — defaults to "MP". Pass e.g. "REPAIR PT" for a TI-LFA repair point, which isn't formally a "Merge Point" in SR terminology. */
  mergePointLabel?: string;
  /** Row label for the mergePoint value — defaults to "Merge Point". */
  mergePointTitle?: string;
  protectionType: "LINK" | "NODE";
  readiness: "READY" | "UNAVAILABLE" | "NOT CONFIGURED";
  active: boolean;
  failure?: string;
}) {
  const readinessTone = readiness === "READY" ? "success" : readiness === "UNAVAILABLE" ? "danger" : "muted";
  return (
    <GlassPanel strong className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">{title}</h4>
        <div className="flex gap-1.5">
          <Badge tone={protectionType === "NODE" ? "violet" : "cyan"}>{protectionType} PROTECTION</Badge>
          <Badge tone={readinessTone}>{readiness}</Badge>
          {active && <Badge tone="warning">ACTIVE</Badge>}
        </div>
      </div>

      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Primary Path</p>
        <div className="flex flex-wrap items-center gap-1 pv-mono text-xs">
          {primaryPath.map((hop, i) => (
            <span key={hop + i} className="flex items-center gap-1">
              <span className={clsx("rounded-lg border px-2 py-1", hop === plr ? "border-pv-cyan/50 bg-pv-cyan/10 text-pv-cyan-soft" : hop === mergePoint ? "border-pv-violet/50 bg-pv-violet/10 text-pv-violet" : "border-pv-border text-pv-text")}>
                {hop}
                {hop === plr && <span className="ml-1 text-[9px] text-pv-cyan-soft">{plrLabel}</span>}
                {hop === mergePoint && <span className="ml-1 text-[9px] text-pv-violet">{mergePointLabel}</span>}
              </span>
              {i < primaryPath.length - 1 && <span className={clsx("text-pv-text-faint", failure && protectedResource.includes(hop) && protectedResource.includes(primaryPath[i + 1]) && "text-pv-danger")}>{failure && protectedResource.includes(hop) && protectedResource.includes(primaryPath[i + 1]) ? "✕" : "→"}</span>}
            </span>
          ))}
        </div>
      </div>

      {backupPath && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">{backupPathLabel}</p>
          <div className={clsx("flex flex-wrap items-center gap-1 pv-mono text-xs", !active && "opacity-60")}>
            {backupPath.map((hop, i) => (
              <span key={hop + i} className="flex items-center gap-1">
                <span className={clsx("rounded-lg border px-2 py-1", active ? "border-pv-warning/50 bg-pv-warning/10 text-pv-warning" : "border-pv-border text-pv-text-muted")}>{hop}</span>
                {i < backupPath.length - 1 && <span className="text-pv-text-faint">→</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-pv-border pt-2 pv-mono text-[11px]">
        <span className="text-pv-text-faint">Protected Resource</span>
        <span className="text-pv-text">{protectedResource}</span>
        <span className="text-pv-text-faint">{plrLabel}</span>
        <span className="text-pv-text">{plr}</span>
        <span className="text-pv-text-faint">{mergePointTitle}</span>
        <span className="text-pv-text">{mergePoint ?? "—"}</span>
      </div>

      {failure && (
        <div className="rounded-lg border border-pv-danger/40 bg-pv-danger/5 p-2.5 text-xs text-pv-danger">{failure}</div>
      )}
    </GlassPanel>
  );
}
