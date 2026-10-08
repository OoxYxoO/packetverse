"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { clsx } from "clsx";

/**
 * PracticeLabShell — the reusable Practice Lab WORKSPACE (presentation only).
 *
 * It owns layout and chrome: full-screen dialog, sandbox note, Reset /
 * Return / animation controls, the lab's own timeline, the Predict → Act →
 * Observe → Verify strip, the desktop split (pinned topology + Teaching
 * Board on the left, live state + event log + CLI on the right), mobile
 * tabs, scroll locking, Escape and focus. Everything inside — topology,
 * board, tables, terminal — is a slot filled by the lesson. It holds no
 * protocol knowledge and never touches lesson progress.
 */

export interface LabStageDef {
  id: string;
  label: string;
}

export type PracticeLabTab = "topology" | "state" | "cli";

export interface PracticeLabShellProps {
  open: boolean;
  onClose: () => void;
  /** e.g. "ARP Lab", "Ethernet Lab". */
  title: string;
  /** Small sandbox reminder next to the title. */
  sandboxNote?: string;
  onReset: () => void;
  animate?: boolean;
  onToggleAnimate?: () => void;
  /** The lab's own timeline (not the guided lesson's). */
  stages: LabStageDef[];
  currentStage: number;
  /** Extra pill after the timeline (e.g. "✓ IP frame"). */
  stageSuffix?: ReactNode;
  /** Learning-loop strip; `current` = -1 when the loop is complete. */
  loop?: { labels?: string[]; current: number };
  /** The lab's main next action; rendered beside the topology on desktop and in the tab bar on phones. */
  primaryAction?: (compact: boolean) => ReactNode;
  /** Topology host — any lesson-supplied view (e.g. <LabTopology> or a specialised diagram). */
  topology: ReactNode;
  /** Height of the pinned topology area. */
  topologyClassName?: string;
  /** Under the topology, inside the pinned area: device details, secondary controls… */
  topologyFooter?: ReactNode;
  /** Secondary controls next to the primary action (replay, auto-run…). */
  controls?: ReactNode;
  /** One-line "current event" strip at the bottom of the pinned area. */
  eventStrip?: ReactNode;
  /** Scrolling left column: the Teaching Board and anything that belongs with it. */
  board: ReactNode;
  liveState?: ReactNode;
  /** Heading above liveState (default "Live state"); an empty string hides it. */
  liveStateLabel?: string;
  eventLog?: ReactNode;
  /** Optional — labs/devices without a meaningful CLI simply omit it. */
  cli?: ReactNode;
  cliHeader?: ReactNode;
  /** Controlled mobile tab (lets a lesson jump to "cli" after "Inspect in CLI"); uncontrolled when omitted. */
  mobileTab?: PracticeLabTab;
  onMobileTabChange?: (tab: PracticeLabTab) => void;
  /** Optional mobile tab names for labs whose panels aren't "State"/"CLI" (e.g. a packet capture in the third slot). Defaults unchanged. */
  tabLabels?: Partial<Record<PracticeLabTab, string>>;
}

const DEFAULT_LOOP = ["Predict", "Act", "Observe", "Verify"];
const TAB_LABEL: Record<PracticeLabTab, string> = { topology: "Topology", state: "State", cli: "CLI" };

export function PracticeLabShell(props: PracticeLabShellProps) {
  const { open, onClose, title, sandboxNote = "Same network as the lesson · sandbox, no progress", onReset, animate, onToggleAnimate, stages, currentStage, stageSuffix, loop, primaryAction, topology, topologyClassName = "h-[min(124vw,500px)] sm:h-[clamp(170px,32vh,290px)]", topologyFooter, controls, eventStrip, board, liveState, eventLog, cli, cliHeader, tabLabels } = props;
  const tabLabel = (t: PracticeLabTab) => tabLabels?.[t] ?? TAB_LABEL[t];
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [ownTab, setOwnTab] = useState<PracticeLabTab>("topology");
  const tab = props.mobileTab ?? ownTab;
  const setTab = props.onMobileTabChange ?? setOwnTab;
  const tabs: PracticeLabTab[] = ["topology", ...(liveState || eventLog ? (["state"] as const) : []), ...(cli ? (["cli"] as const) : [])];
  const hasRight = tabs.length > 1;

  useEffect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    titleRef.current?.focus();
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [open]);

  const animToggle = (className: string) =>
    onToggleAnimate ? (
      <button type="button" aria-pressed={animate} onClick={onToggleAnimate} className={clsx("rounded-full border border-pv-border px-2.5 py-1 text-[11px] text-pv-text-faint hover:text-pv-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan", className)}>
        Animation: {animate ? "on" : "off"}
      </button>
    ) : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="practice-lab-title"
      aria-hidden={!open}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !(e.target instanceof HTMLInputElement)) onClose();
      }}
      className={clsx("fixed inset-0 z-[55] flex-col bg-pv-bg", open ? "flex" : "hidden")}
    >
      <header className="shrink-0 border-b border-pv-border bg-pv-bg-elevated/70 px-3 py-2 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <h2 id="practice-lab-title" ref={titleRef} tabIndex={-1} className="text-base font-semibold text-pv-text outline-none sm:text-lg">
              {title}
            </h2>
            <span className="hidden rounded-full border border-pv-border px-2 py-0.5 text-[10px] text-pv-text-faint md:inline">{sandboxNote}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {animToggle("hidden sm:inline")}
            <button type="button" onClick={onReset} className="rounded-full border border-pv-warning/50 bg-pv-warning/10 px-3 py-1 text-[12px] font-semibold text-pv-warning hover:bg-pv-warning/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-warning">
              ⟲ Reset Lab
            </button>
            <button type="button" onClick={onClose} className="rounded-full border border-pv-border px-3 py-1 text-[12px] font-semibold text-pv-text hover:border-pv-cyan/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan">
              ← Return to lesson
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <ol className="flex flex-wrap items-center gap-1" aria-label={`${title} timeline`}>
            {stages.map((st, i) => {
              const current = i === currentStage;
              const passed = i < currentStage;
              return (
                <li key={st.id} className="flex shrink-0 items-center gap-1" aria-current={current ? "step" : undefined}>
                  {i > 0 && (
                    <span aria-hidden className={clsx("text-xs", passed || current ? "text-pv-cyan-soft" : "text-pv-text-faint")}>
                      →
                    </span>
                  )}
                  <span className={clsx("flex items-baseline gap-1 rounded-full border px-2 py-0.5 text-[11px]", current ? "border-pv-cyan/60 bg-pv-cyan/15 font-semibold text-pv-cyan-soft" : passed ? "border-pv-success/40 text-pv-success" : "border-pv-border text-pv-text-faint")}>
                    <span className="pv-mono text-[10px]">T{i}</span>
                    <span className={current ? undefined : "sr-only sm:not-sr-only"}>{st.label}</span>
                    {passed && <span className="sr-only"> (done)</span>}
                  </span>
                </li>
              );
            })}
            {stageSuffix && <li className="ml-1 shrink-0">{stageSuffix}</li>}
          </ol>
          {loop && (
            <ol className="flex items-center gap-1 text-[10.5px]" aria-label="Learning loop">
              {(loop.labels ?? DEFAULT_LOOP).map((step, i) => {
                const done = loop.current === -1 || i < loop.current;
                const current = i === loop.current;
                return (
                  <li key={step} aria-current={current ? "step" : undefined} className={clsx("rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide", current ? "bg-pv-violet/20 text-pv-violet" : done ? "text-pv-success" : "text-pv-text-faint")}>
                    {step}
                    {done ? " ✓" : ""}
                    {current && <span className="sr-only"> (current)</span>}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </header>

      <div className="flex shrink-0 items-center gap-2 border-b border-pv-border px-3 py-1.5 lg:hidden">
        {hasRight && (
          <div role="tablist" aria-label={`${title} panels`} className="flex gap-0.5 rounded-full border border-pv-border p-0.5">
            {tabs.map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={clsx("rounded-full px-3 py-1 text-[12px] font-semibold", tab === t ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint")}>
                {tabLabel(t)}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto">{primaryAction?.(true)}</div>
      </div>

      <div className={clsx("min-h-0 flex-1", hasRight && "lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]")}>
        <section aria-label="Topology and Teaching Board" className={clsx("h-full min-h-0 overflow-y-auto", tab === "topology" || !hasRight ? "block" : "hidden", "lg:block")}>
          <div className="z-10 space-y-2 border-b border-pv-border bg-pv-bg/95 px-3 pb-2.5 pt-2 backdrop-blur sm:px-5 lg:sticky lg:top-0">
            <div className={clsx("mx-auto max-w-4xl", topologyClassName)}>{topology}</div>
            {topologyFooter}
            <div className="flex flex-wrap items-center gap-2">
              {primaryAction && <div className="hidden lg:block">{primaryAction(false)}</div>}
              {controls}
              {animToggle("sm:hidden")}
            </div>
            {eventStrip}
          </div>
          <div className="space-y-3 px-3 py-3 sm:px-5">{board}</div>
        </section>

        {hasRight && (
          <section aria-label={tabLabels ? `${tabLabel("state")} and ${tabLabel("cli")}` : "Live state and CLI"} className={clsx("h-full min-h-0 flex-col overflow-y-auto border-pv-border lg:flex lg:border-l", tab === "topology" ? "hidden" : "flex")}>
            {(liveState || eventLog) && (
              <div className={clsx("space-y-2 px-3 pt-3 sm:px-5", tab === "state" ? "block" : "hidden", "lg:block")}>
                {liveState && (
                  <>
                    {(props.liveStateLabel ?? "Live state") && <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">{props.liveStateLabel ?? "Live state"}</p>}
                    {liveState}
                  </>
                )}
                {eventLog}
              </div>
            )}
            {cli && (
              <div className={clsx("space-y-2 px-3 pb-3 pt-3 sm:px-5", tab === "cli" ? "block" : "hidden", "lg:block")}>
                {cliHeader}
                {cli}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
