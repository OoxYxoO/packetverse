import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface EthernetFdbRow {
  mac: string;
  /** "SPOKE_PW"/"MESH_PW" added for H-VPLS's hierarchical port roles — every existing caller only ever passes "AC"/"PW" and renders identically. */
  portKind: "AC" | "PW" | "SPOKE_PW" | "MESH_PW";
  portPeer: string;
  age?: number;
  justChanged?: boolean;
}

const PORT_KIND_TONE: Record<EthernetFdbRow["portKind"], "cyan" | "violet" | "warning"> = { AC: "cyan", PW: "violet", SPOKE_PW: "warning", MESH_PW: "violet" };

/**
 * Generic Ethernet MAC/FDB table viewer — plain rows in, plain table
 * out. Knows nothing about VPLS, learning, split horizon, or any
 * bridging logic; every row is handed in already computed. Distinct
 * from MACTableViewer (a simpler MAC→port map with no port-kind
 * distinction, no age, no change highlighting) — this shape is needed
 * wherever a bridge port can be either a local AC or a remote PW.
 */
export function EthernetFdbViewer({ title, rows }: { title: string; rows: EthernetFdbRow[] }) {
  return (
    <GlassPanel className="p-4">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title} — MAC / FDB Table</h4>
      {rows.length === 0 ? (
        <p className="pv-mono text-xs text-pv-text-faint">EMPTY — nothing learned yet</p>
      ) : (
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="text-pv-text-faint">
              <th className="pb-1 font-normal">MAC Address</th>
              <th className="pb-1 font-normal">Port</th>
              <th className="pb-1 font-normal">Age</th>
            </tr>
          </thead>
          <tbody className="pv-mono text-pv-text">
            {rows.map((r) => (
              <tr key={r.mac} className={`border-t border-pv-border ${r.justChanged ? "bg-pv-cyan-soft/10" : ""}`}>
                <td className="py-1.5">{r.mac}</td>
                <td className="py-1.5">
                  <Badge tone={PORT_KIND_TONE[r.portKind]}>
                    {r.portKind}: {r.portPeer}
                  </Badge>
                </td>
                <td className="py-1.5 text-pv-text-faint">{r.age ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </GlassPanel>
  );
}
