import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface LibEntryRow {
  fec: string;
  localLabel?: string;
  remoteBindings: { neighbor: string; label: string }[];
}

/** Label Information Base viewer (brief §8) — control-plane bookkeeping: every label binding heard, used or not. */
export function LibViewer({ title, entries }: { title: string; entries: LibEntryRow[] }) {
  return (
    <GlassPanel className="p-4">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title} — LIB (control plane)</h4>
      {entries.length === 0 ? (
        <p className="pv-mono text-xs text-pv-text-faint">EMPTY</p>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => (
            <div key={e.fec} className="rounded-lg border border-pv-border p-2.5 text-[11px]">
              <p className="mb-1 pv-mono font-semibold text-pv-text">FEC {e.fec}</p>
              {e.localLabel && (
                <p className="pv-mono text-pv-cyan-soft">
                  local label: <span className="text-pv-text">{e.localLabel}</span>
                </p>
              )}
              {e.remoteBindings.map((b) => (
                <p key={b.neighbor} className="pv-mono text-pv-text-muted">
                  from {b.neighbor}: <span className="text-pv-text">{b.label}</span>
                </p>
              ))}
              {!e.localLabel && e.remoteBindings.length === 0 && <p className="text-pv-text-faint">no bindings yet</p>}
            </div>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}

export interface LfibEntryRow {
  fec: string;
  incomingLabel: string;
  action: string;
  outgoingLabel?: string;
  outgoingInterface?: string;
}

const ACTION_TONE: Record<string, "cyan" | "success" | "warning" | "danger" | "muted"> = {
  PUSH: "cyan",
  SWAP: "success",
  POP: "warning",
  POP_AND_LOOKUP: "warning",
  IP_FORWARD: "muted",
  DROP: "danger",
};

/** Label Forwarding Information Base viewer (brief §8) — only what's actually used to switch packets. */
export function LfibViewer({ title, entries }: { title: string; entries: LfibEntryRow[] }) {
  return (
    <GlassPanel className="p-4">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title} — LFIB (forwarding plane)</h4>
      {entries.length === 0 ? (
        <p className="pv-mono text-xs text-pv-text-faint">EMPTY</p>
      ) : (
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="text-pv-text-faint">
              <th className="pb-1 font-normal">In</th>
              <th className="pb-1 font-normal">Action</th>
              <th className="pb-1 font-normal">Out</th>
              <th className="pb-1 font-normal">Via</th>
            </tr>
          </thead>
          <tbody className="pv-mono text-pv-text">
            {entries.map((e) => (
              <tr key={e.fec} className="border-t border-pv-border">
                <td className="py-1.5">{e.incomingLabel}</td>
                <td className="py-1.5">
                  <Badge tone={ACTION_TONE[e.action] ?? "muted"}>{e.action}</Badge>
                </td>
                <td className="py-1.5">{e.outgoingLabel ?? "—"}</td>
                <td className={clsx("py-1.5", "text-pv-cyan-soft")}>{e.outgoingInterface ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </GlassPanel>
  );
}
