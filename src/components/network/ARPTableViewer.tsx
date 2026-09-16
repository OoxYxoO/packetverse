import { GlassPanel } from "@/components/ui/GlassPanel";

export function ARPTableViewer({ title, entries }: { title: string; entries: Record<string, string> }) {
  const rows = Object.entries(entries);
  return (
    <GlassPanel className="p-4">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title} — ARP Table</h4>
      {rows.length === 0 ? (
        <p className="pv-mono text-xs text-pv-text-faint">EMPTY</p>
      ) : (
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="text-pv-text-faint">
              <th className="pb-1 font-normal">IP Address</th>
              <th className="pb-1 font-normal">MAC Address</th>
            </tr>
          </thead>
          <tbody className="pv-mono text-pv-text">
            {rows.map(([ip, mac]) => (
              <tr key={ip} className="border-t border-pv-border">
                <td className="py-1.5">{ip}</td>
                <td className="py-1.5 text-pv-cyan-soft">{mac}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </GlassPanel>
  );
}
