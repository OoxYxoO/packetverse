import { clsx } from "clsx";

interface ProcessPipelineProps {
  stages: string[];
  currentStage: string;
  title?: string;
}

/**
 * Generic horizontal process-stage tracker (e.g. BGP's UPDATE RECEIVED
 * → VALIDATE → ADD TO TABLE → COMPARE → SELECT BEST → INSTALL, brief
 * §21). Not protocol-specific — any scenario can hand it a stage list
 * and the current stage name; it holds no logic of its own.
 */
export function ProcessPipeline({ stages, currentStage, title }: ProcessPipelineProps) {
  const currentIndex = stages.indexOf(currentStage);
  return (
    <div>
      {title && <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-pv-text-muted">{title}</p>}
      <div className="flex flex-wrap items-center gap-1">
        {stages.map((stage, i) => (
          <span key={stage} className="flex items-center gap-1">
            <span
              className={clsx(
                "rounded-full border px-2 py-1 pv-mono text-[9px] font-semibold uppercase tracking-wide",
                i === currentIndex && "border-pv-cyan/50 bg-pv-cyan/10 text-pv-cyan animate-glow",
                i < currentIndex && "border-pv-success/40 bg-pv-success/5 text-pv-success",
                i > currentIndex && "border-pv-border text-pv-text-faint",
              )}
            >
              {stage}
            </span>
            {i < stages.length - 1 && <span className="text-pv-text-faint">→</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
