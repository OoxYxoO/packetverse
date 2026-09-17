import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface Srv6BehaviorExecutionData {
  activeSid: string;
  matchedLocalSid: string;
  behavior: string;
  input: string;
  validation: string;
  transformation: string;
  egressDecision: string;
  resultingPacket: string;
  dropped?: boolean;
}

/**
 * Generic per-hop SRv6 endpoint-behavior execution viewer — a single
 * card walking active SID → matched local SID → behavior → input →
 * validation → transformation → egress decision → resulting packet.
 * Every field is handed in already computed; this component contains
 * no dispatch logic and never decides pass/fail on its own.
 */
export function Srv6BehaviorExecutionViewer({ title = "Behavior Execution", data }: { title?: string; data: Srv6BehaviorExecutionData }) {
  const rows: { label: string; value: string }[] = [
    { label: "Active SID", value: data.activeSid },
    { label: "Matched Local SID", value: data.matchedLocalSid },
    { label: "Behavior", value: data.behavior },
    { label: "Input", value: data.input },
    { label: "Validation", value: data.validation },
    { label: "Transformation", value: data.transformation },
    { label: "Egress Decision", value: data.egressDecision },
  ];
  return (
    <GlassPanel className="p-4" glow={data.dropped ? "danger" : "success"}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title}</h4>
        <Badge tone={data.dropped ? "danger" : "success"}>{data.dropped ? "DROPPED" : "EXECUTED"}</Badge>
      </div>
      <div className="space-y-1.5 pv-mono text-[11px]">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-wrap justify-between gap-2 border-b border-pv-border/60 pb-1.5 last:border-b-0 last:pb-0">
            <span className="text-pv-text-faint">{r.label}</span>
            <span className="break-all text-right text-pv-text">{r.value}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-lg border border-pv-cyan/30 bg-pv-cyan/5 p-2.5">
        <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Resulting Packet</p>
        <p className="pv-mono text-xs text-pv-text">{data.resultingPacket}</p>
      </div>
    </GlassPanel>
  );
}
