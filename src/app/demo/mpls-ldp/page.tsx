"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  GRAPH_EDGES,
  GRAPH_NODES,
  GRAPH_REGIONS,
  LDP_LINKS,
  LDP_STATE_INFO,
  LDP_STATE_LABEL,
  LDP_STATE_ORDER,
  PROVIDER_ROUTERS,
  TERMS,
  buildMplsCliCommands,
  createMplsState,
  fmtLabel,
  mplsSteps,
  type MplsState,
  type RouterId,
} from "@/lib/sim-engine/scenarios/mplsLdp";
import { GraphTopologyViewer, type GraphEdge } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { ProtocolStateMachine } from "@/components/protocol/ProtocolStateMachine";
import { LibViewer, LfibViewer } from "@/components/protocol/LibLfibViewer";
import { RouteTablePanel } from "@/components/protocol/RouteTablePanel";
import { ForwardingDecisionCard } from "@/components/protocol/ForwardingDecisionCard";
import { PacketJourneyTimeline } from "@/components/protocol/PacketJourneyTimeline";
import { LabelFlowView } from "@/components/protocol/LabelFlowView";
import { PlaneSplitPanel } from "@/components/protocol/PlaneSplitPanel";
import { CLIOutputPanel } from "@/components/protocol/CLIOutputPanel";
import { PredictionQuestion } from "@/components/quiz/PredictionQuestion";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useProgressStore } from "@/lib/state/useProgressStore";

const WHY_MPLS: { q: string; a: string }[] = [
  { q: "WHAT is MPLS?", a: "A forwarding technology that classifies traffic once, at the edge, and switches it through the core using short labels." },
  { q: "WHY use it?", a: "Scalable forwarding, traffic engineering, and services (like VPNs) — not because label lookups are inherently \"faster\" than IP." },
  { q: "WHAT does it NOT replace?", a: "The IGP (OSPF) — MPLS forwards along paths the IGP already says are reachable." },
  { q: "WHEN do engineers use it?", a: "Provider cores that need scalable per-service forwarding state, not just best-effort IP." },
];

const REPAIR_OPTIONS = [
  { id: "restart-ospf", label: "Restart OSPF on P1" },
  { id: "reboot-p2", label: "Reboot P2" },
  { id: "enable-ldp", label: "Enable LDP on the P1 ↔ P2 interface" },
  { id: "increase-mtu", label: "Increase the MTU on P1 ↔ P2" },
];
const WRONG_FEEDBACK: Record<string, string> = {
  "restart-ospf": "OSPF is already healthy — restarting it doesn't touch the LDP session at all.",
  "reboot-p2": "A reboot tears down everything, not just the LDP session — and doesn't address why LDP wasn't enabled.",
  "increase-mtu": "MTU isn't the problem here — the LDP session simply isn't up on this link.",
};

export default function MplsLdpDemo() {
  const { engine, snapshot } = useScenarioEngine<MplsState>(createMplsState(), mplsSteps);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [viewMode, setViewMode] = useState<"physical" | "labelFlow">("physical");
  const [focusRouter, setFocusRouter] = useState<RouterId>("P1");
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);
  const awardedRef = useRef(false);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();

  const edges: GraphEdge[] = useMemo(
    () =>
      GRAPH_EDGES.map((e) => {
        const link = LDP_LINKS.find((l) => (l.a === e.a && l.b === e.b) || (l.a === e.b && l.b === e.a));
        if (!link) return { id: e.id, a: e.a, b: e.b, state: "full" as const };
        const st = state.ldp[link.id];
        return { id: e.id, a: e.a, b: e.b, label: e.label, state: st === "OPERATIONAL" ? ("full" as const) : st === "DOWN" ? ("down" as const) : ("forming" as const) };
      }),
    [state.ldp],
  );

  const activeNodeIds = activePacket ? [activePacket.from, activePacket.to] : [];
  const packetFrom = activePacket ? GRAPH_NODES.find((n) => n.id === activePacket.from) : undefined;
  const packetTo = activePacket ? GRAPH_NODES.find((n) => n.id === activePacket.to) : undefined;

  const cliCommands = useMemo(() => buildMplsCliCommands(state, focusRouter), [state, focusRouter]);
  const lastHop = state.journey[state.journey.length - 1];
  const showPlaneSplit = index >= mplsSteps.findIndex((s) => s.id === "ldp-discovery-intro");

  const labelFlowNodes = useMemo(
    () =>
      PROVIDER_ROUTERS.map((r) => {
        const entry = state.lfib[r]?.[0];
        const outputLabel = entry ? (entry.action === "POP" ? "IP" : entry.outgoingLabel !== undefined ? fmtLabel(entry.outgoingLabel) : "—") : r === "PE2" ? "IP" : "—";
        return { router: r, action: entry?.action, outputLabel };
      }),
    [state.lfib],
  );

  useEffect(() => {
    if (isComplete && !awardedRef.current) {
      awardedRef.current = true;
      completeLesson("mpls-fundamentals", 250);
      unlockAchievement("label-switcher");
    }
  }, [isComplete, completeLesson, unlockAchievement]);

  useEffect(() => {
    if (!autoPlay || !canAdvance || isComplete) return;
    const t = setTimeout(() => engine.advance(), 2200 / speed);
    return () => clearTimeout(t);
  }, [autoPlay, canAdvance, isComplete, index, engine, speed]);

  const handleAnswer = (optionId: string) => {
    engine.answer(optionId);
    if (currentStep?.question) recordAnswer(optionId === currentStep.question.correctOptionId);
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Apply the correct fix to continue" : "Next Step →";

  const focusLib = (state.lib[focusRouter] ?? []).map((e) => ({
    fec: e.fec,
    localLabel: e.localLabel !== undefined ? fmtLabel(e.localLabel) : undefined,
    remoteBindings: e.remoteBindings.map((b) => ({ neighbor: b.neighbor, label: fmtLabel(b.label) })),
  }));
  const focusLfib = (state.lfib[focusRouter] ?? []).map((e) => ({
    fec: e.fec,
    incomingLabel: e.incomingLabel === "UNLABELED" ? "unlabeled" : fmtLabel(e.incomingLabel),
    action: e.action,
    outgoingLabel: e.outgoingLabel !== undefined ? fmtLabel(e.outgoingLabel) : undefined,
    outgoingInterface: e.outgoingInterface,
  }));
  const focusIgp = state.igpRoutes[focusRouter];

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="cyan" className="mb-3">
          MPLS · LDP · Label Switching (Transport Only)
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">One Packet, Three Labels, Zero Extra IP Lookups</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          CE1 → PE1 → P1 → P2 → PE2 → CE2. Bring up LDP yourself, watch label bindings distribute upstream from PE2, then push, swap
          and pop a real label stack across the core.
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {WHY_MPLS.map((item) => (
          <GlassPanel key={item.q} className="p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">{item.q}</p>
            <p className="text-[11px] leading-snug text-pv-text-muted">{item.a}</p>
          </GlassPanel>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {TERMS.map((t) => (
          <GlassPanel key={t.term} className="p-2.5" title={t.meaning}>
            <p className="pv-mono text-xs font-bold text-pv-text">{t.term}</p>
            <p className="text-[10px] text-pv-text-faint">{t.expansion}</p>
          </GlassPanel>
        ))}
      </div>

      {/* TIMELINE */}
      <div className="mb-4 flex gap-1 overflow-x-auto pb-2">
        {mplsSteps.map((step, i) => (
          <button
            key={step.id}
            type="button"
            disabled={i > index}
            onClick={() => i < index && engine.goTo(i)}
            title={step.label}
            className={clsx(
              "h-1.5 flex-1 min-w-4 rounded-full transition-colors",
              i < index ? "bg-pv-success/70 hover:bg-pv-success cursor-pointer" : i === index ? "bg-pv-cyan" : "bg-white/10",
            )}
          />
        ))}
      </div>

      <div className="mb-6 flex gap-1 rounded-full border border-pv-border p-0.5 w-fit">
        {(["physical", "labelFlow"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setViewMode(m)}
            className={clsx(
              "rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors",
              viewMode === m ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text",
            )}
          >
            {m === "physical" ? "Physical Topology" : "Label Flow"}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        {/* MAIN COLUMN */}
        <div className="space-y-6">
          {viewMode === "physical" ? (
            <GraphTopologyViewer nodes={GRAPH_NODES} edges={edges} activeNodeIds={activeNodeIds} regions={GRAPH_REGIONS}>
              {activePacket && packetFrom && packetTo && <GraphPacket packet={activePacket} from={packetFrom} to={packetTo} />}
            </GraphTopologyViewer>
          ) : (
            <LabelFlowView nodes={labelFlowNodes} />
          )}

          {lastHop && (
            <ForwardingDecisionCard router={lastHop.router} input={lastHop.input} lookup={lastHop.lookup} action={lastHop.action} output={lastHop.output} />
          )}

          {!isComplete && currentStep && (
            <GlassPanel strong className="p-6">
              <div className="mb-2 flex items-center gap-2">
                <Badge tone="muted">
                  Step {index + 1} / {totalSteps}
                </Badge>
                <span className="text-xs text-pv-text-faint">{currentStep.label}</span>
              </div>
              <p className="text-sm leading-relaxed text-pv-text">{currentStep.narrative}</p>
            </GlassPanel>
          )}

          {!isComplete && currentStep?.question && (
            <PredictionQuestion
              question={currentStep.question}
              selectedOptionId={lastAnswer?.stepId === currentStep.id ? lastAnswer.optionId : undefined}
              onAnswer={handleAnswer}
            />
          )}

          {!isComplete && currentStep?.id === "repair-challenge" && (
            <RepairChallenge options={REPAIR_OPTIONS} attempt={state.repairAttempt} onTry={(choice) => engine.act({ choice })} />
          )}

          {whatChanged.length > 0 && !currentStep?.question && currentStep?.id !== "repair-challenge" && (
            <GlassPanel className="p-5">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">What changed?</h3>
              <ul className="space-y-1.5">
                {whatChanged.map((c) => (
                  <li key={c} className="flex gap-2 text-xs text-pv-text-muted">
                    <span className="text-pv-success">✓</span>
                    {c}
                  </li>
                ))}
              </ul>
            </GlassPanel>
          )}

          {showPlaneSplit && !isComplete && (
            <PlaneSplitPanel
              controlTitle="Control Plane — OSPF + LDP"
              controlRows={[
                { label: "IGP (OSPF)", value: "Converged" },
                ...LDP_LINKS.map((l) => ({ label: `LDP ${l.a}↔${l.b}`, value: LDP_STATE_LABEL[state.ldp[l.id]] })),
              ]}
              dataTitle="Data Plane — Current Packet"
              dataRows={
                state.packet
                  ? [
                      { label: "Location", value: state.packetAt ?? "—" },
                      { label: "Labels on wire", value: state.packet.labels.length ? state.packet.labels.map((l) => l.value).join(", ") : "(none)" },
                      { label: "Destination", value: state.packet.dstIp },
                    ]
                  : [{ label: "Packet", value: "none in flight" }]
              }
            />
          )}

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">Label Switcher</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">The LSP Is Operational</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You brought up LDP from Hello through label mapping, watched PUSH → SWAP → POP transform a real label stack, learned
                why penultimate hop popping exists, and repaired a broken LDP adjacency under a healthy IGP. +250 XP awarded.
              </p>
              <div className="flex gap-3">
                <Button onClick={() => { awardedRef.current = false; engine.restart(); }} variant="secondary">
                  Restart Lesson
                </Button>
                <Link href="/dashboard">
                  <Button>View Dashboard</Button>
                </Link>
              </div>
            </GlassPanel>
          )}

          {!isComplete && (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" size="sm" onClick={() => engine.goTo(Math.max(0, index - 1))} disabled={index === 0}>
                ← Previous
              </Button>
              <Button size="sm" onClick={() => engine.advance()} disabled={!canAdvance}>
                {nextLabel}
              </Button>
              <Button variant={autoPlay ? "primary" : "ghost"} size="sm" onClick={() => setAutoPlay((v) => !v)}>
                {autoPlay ? "⏸ Auto-Playing" : "▶ Auto-Play"}
              </Button>
              <div className="flex gap-1 rounded-full border border-pv-border p-0.5">
                {([0.5, 1, 2] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSpeed(s)}
                    className={clsx(
                      "rounded-full px-2.5 py-1 text-[10px] font-semibold pv-mono transition-colors",
                      speed === s ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text",
                    )}
                  >
                    {s}x
                  </button>
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={() => engine.restart()}>
                ⟲ Restart
              </Button>
            </div>
          )}
        </div>

        {/* SIDEBAR */}
        <div className="space-y-4">
          <PacketInspector packet={activePacket} />

          <ProtocolStateMachine
            title="PE1 ↔ P1 LDP Session"
            states={LDP_STATE_ORDER}
            labels={LDP_STATE_LABEL}
            current={state.ldp["PE1-P1"]}
            descriptions={LDP_STATE_INFO}
          />

          <div className="flex flex-wrap gap-1 rounded-full border border-pv-border p-0.5 w-fit">
            {PROVIDER_ROUTERS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setFocusRouter(r)}
                className={clsx(
                  "rounded-full px-3 py-1 text-[11px] font-semibold pv-mono transition-colors",
                  focusRouter === r ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text",
                )}
              >
                {r}
              </button>
            ))}
          </div>

          <RouteTablePanel title={`${focusRouter} — IGP Route`} routes={focusIgp ? [focusIgp] : []} />
          <LibViewer title={focusRouter} entries={focusLib} />
          <LfibViewer title={focusRouter} entries={focusLfib} />
          <PacketJourneyTimeline hops={state.journey} />
          <CLIOutputPanel commands={cliCommands} />
        </div>
      </div>
    </div>
  );
}

function RepairChallenge({
  options,
  attempt,
  onTry,
}: {
  options: { id: string; label: string }[];
  attempt?: { choice: string; correct: boolean };
  onTry: (choice: string) => void;
}) {
  return (
    <GlassPanel strong className="p-5">
      <p className="mb-3 text-sm font-medium text-pv-text">Choose the correct repair for the P1 ↔ P2 link:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = attempt?.choice === opt.id;
          const isCorrect = opt.id === "enable-ldp";
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onTry(opt.id)}
              className={clsx(
                "rounded-xl border px-4 py-3 text-left text-sm transition-colors cursor-pointer",
                isSelected && isCorrect && "border-pv-success/50 bg-pv-success/10 text-pv-success",
                isSelected && !isCorrect && "border-pv-danger/50 bg-pv-danger/10 text-pv-danger",
                !isSelected && "border-pv-border hover:border-pv-cyan/40 hover:bg-pv-cyan/5",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {attempt && (
        <div
          className={clsx(
            "mt-4 rounded-xl border p-4 text-sm",
            attempt.correct ? "border-pv-success/50 bg-pv-success/10 text-pv-success" : "border-pv-warning/40 bg-pv-warning/5 text-pv-text-muted",
          )}
        >
          {attempt.correct ? (
            <span className="font-semibold">✓ LDP re-enabled — Hello, session, and label mapping all restored.</span>
          ) : (
            <>
              <span className="mb-1 block font-semibold text-pv-text">That doesn&apos;t fix it.</span>
              {WRONG_FEEDBACK[attempt.choice] ?? "Try again."}
            </>
          )}
        </div>
      )}
    </GlassPanel>
  );
}
