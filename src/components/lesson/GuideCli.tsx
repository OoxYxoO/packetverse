import type { ReactNode } from "react";
import { executeCli } from "@/lib/cli/parser";
import type { CliCommandSet } from "@/lib/cli/types";

/**
 * Real command output inside a Lesson Guide. The guide runs the lab's own command set against a lab state (the same
 * model the Practice Lab uses), so what the student reads here is exactly what the lab prints — one network truth.
 */
export interface GuideCliRun {
  prompt: string;
  command: string;
  output: string;
}
/** Run one command through a lab command set (output only — no explanation line). */
export function runGuideCli(set: CliCommandSet | undefined, command: string): GuideCliRun {
  if (!set) return { prompt: "", command, output: "" };
  const r = executeCli(set, command);
  return { prompt: set.prompt, command, output: r.kind === "ok" ? r.output : r.kind === "error" ? r.output : "" };
}
/** Keep only the lines of a long output that matter for the point being made (header lines can be kept with `keep`). */
export const pickLines = (output: string, match: RegExp, keep = 0) => {
  const lines = output.split("\n");
  return [...lines.slice(0, keep), ...lines.slice(keep).filter((l) => match.test(l))].join("\n");
};
export function CliPanel({ run, caption, note }: { run: GuideCliRun; caption?: string; note?: ReactNode }) {
  return (
    <figure className="min-w-0">
      {caption && <figcaption className="mb-1 text-[10px] font-bold uppercase tracking-wide text-pv-text-faint">{caption}</figcaption>}
      <div className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-[#05080d]">
        <pre className="overflow-x-auto px-3 py-2 pv-mono text-[10.5px] leading-relaxed text-pv-text-muted">
          <span className="text-pv-success">{run.prompt}</span>
          <span className="text-pv-text">{run.command}</span>
          {"\n"}
          {run.output}
        </pre>
      </div>
      {note && <p className="mt-1 text-[12px] leading-snug text-pv-text-muted">{note}</p>}
    </figure>
  );
}
/** Two outputs side by side on wide screens (Cisco left, Junos right), stacked on phones. */
export function CliPair({ cisco, junos, ciscoCaption = "Cisco IOS", junosCaption = "Junos" }: { cisco: GuideCliRun; junos: GuideCliRun; ciscoCaption?: string; junosCaption?: string }) {
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      <CliPanel run={cisco} caption={ciscoCaption} />
      <CliPanel run={junos} caption={junosCaption} />
    </div>
  );
}
/** A failure walked through: what was normal, what changed, what the evidence shows, what to check next. */
export function FailureWalk({ title, normal, change, evidence, next, fix, proof, tone = "danger" }: { title: string; normal: ReactNode; change: ReactNode; evidence: ReactNode; next: ReactNode; fix?: ReactNode; proof: ReactNode; tone?: "danger" | "warning" }) {
  const row = (k: string, v: ReactNode, cls: string) => (
    <div className="grid gap-1 border-t border-white/5 py-2 sm:grid-cols-[150px_1fr]">
      <p className={`text-[11px] font-bold uppercase tracking-wide ${cls}`}>{k}</p>
      <div className="min-w-0 space-y-2 text-sm leading-relaxed text-pv-text-muted">{v}</div>
    </div>
  );
  return (
    <div className={`rounded-2xl border p-3 sm:p-4 ${tone === "danger" ? "border-pv-danger/30 bg-pv-danger/[0.03]" : "border-pv-warning/30 bg-pv-warning/[0.03]"}`}>
      <p className="pb-1 text-[15px] font-bold text-pv-text">{title}</p>
      {row("Normal", normal, "text-pv-success")}
      {row("Something changes", change, "text-pv-warning")}
      {row("What you see", evidence, "text-pv-danger")}
      {row("Check next", next, "text-pv-cyan-soft")}
      {fix !== undefined && row("Repair", fix, "text-pv-violet")}
      {row("Proof it's fixed", proof, "text-pv-success")}
    </div>
  );
}
