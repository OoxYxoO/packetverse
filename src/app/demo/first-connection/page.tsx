"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  createFirstConnectionState,
  firstConnectionSteps,
  type FirstConnectionState,
} from "@/lib/sim-engine/scenarios/firstConnection";
import { TopologyViewer } from "@/components/network/TopologyViewer";
import { AnimatedPacket } from "@/components/network/AnimatedPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { ARPTableViewer } from "@/components/network/ARPTableViewer";
import { MACTableViewer } from "@/components/network/MACTableViewer";
import { RouteTableViewer } from "@/components/network/RouteTableViewer";
import { PredictionQuestion } from "@/components/quiz/PredictionQuestion";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useProgressStore } from "@/lib/state/useProgressStore";

export default function FirstConnectionDemo() {
  const { engine, snapshot } = useScenarioEngine<FirstConnectionState>(createFirstConnectionState(), firstConnectionSteps);
  const [autoPlay, setAutoPlay] = useState(false);
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);
  const awardedRef = useRef(false);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const nodeList = useMemo(() => Object.values(state.nodes).sort((a, b) => a.track - b.track), [state.nodes]);

  const activeNodeIds = activePacket ? [activePacket.from, activePacket.to] : [];
  const establishedNodeIds = state.tcp.state === "ESTABLISHED" ? ["laptop", "server"] : [];

  const canAdvance = engine.canAdvance();

  useEffect(() => {
    if (isComplete && !awardedRef.current) {
      awardedRef.current = true;
      // This one simulation teaches both catalog lessons that point
      // to it — mark both complete on the learning map / dashboard.
      completeLesson("arp-resolution", 75);
      completeLesson("tcp-three-way-handshake", 75);
      unlockAchievement("handshake-hero");
    }
  }, [isComplete, completeLesson, unlockAchievement]);

  useEffect(() => {
    if (!autoPlay || !canAdvance || isComplete) return;
    const t = setTimeout(() => engine.advance(), 2200);
    return () => clearTimeout(t);
  }, [autoPlay, canAdvance, isComplete, index, engine]);

  const handleAnswer = (optionId: string) => {
    engine.answer(optionId);
    if (currentStep?.question) recordAnswer(optionId === currentStep.question.correctOptionId);
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-8">
        <Badge tone="cyan" className="mb-3">
          Flagship Demo
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">Laptop → Switch → Router → Server</h1>
        <p className="mt-2 max-w-2xl text-sm text-pv-text-muted">
          You are <span className="pv-mono text-pv-cyan-soft">192.168.10.10</span>. Mission: connect to{" "}
          <span className="pv-mono text-pv-cyan-soft">10.20.20.20</span> over HTTPS. Drive every packet yourself —
          ARP, switching, routing, and the TCP handshake.
        </p>
      </div>

      {/* STEP RAIL */}
      <div className="mb-6 flex gap-1.5 overflow-x-auto pb-2">
        {firstConnectionSteps.map((step, i) => (
          <div
            key={step.id}
            className={clsx(
              "h-1.5 flex-1 min-w-6 rounded-full transition-colors",
              i < index ? "bg-pv-success/70" : i === index ? "bg-pv-cyan" : "bg-white/10",
            )}
            title={step.label}
          />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* MAIN COLUMN */}
        <div className="space-y-6">
          <TopologyViewer nodes={nodeList} activeNodeIds={activeNodeIds} establishedNodeIds={establishedNodeIds}>
            {activePacket && (
              <AnimatedPacket
                packet={activePacket}
                fromTrack={state.nodes[activePacket.from]?.track ?? 0}
                toTrack={state.nodes[activePacket.to]?.track ?? 1}
              />
            )}
          </TopologyViewer>

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

          {whatChanged.length > 0 && !currentStep?.question && (
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

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">Session Established</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">TCP SESSION ESTABLISHED</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You walked ARP resolution, switched forwarding, a routing lookup, and the full TCP three-way
                handshake — end to end, one packet at a time. +150 XP awarded.
              </p>
              <div className="flex gap-3">
                <Button onClick={() => { awardedRef.current = false; engine.restart(); }} variant="secondary">
                  Restart Demo
                </Button>
                <Link href="/dashboard">
                  <Button>View Dashboard</Button>
                </Link>
              </div>
            </GlassPanel>
          )}

          {/* CONTROLS */}
          {!isComplete && (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" size="sm" onClick={() => engine.goTo(Math.max(0, index - 1))} disabled={index === 0}>
                ← Previous
              </Button>
              <Button size="sm" onClick={() => engine.advance()} disabled={!canAdvance}>
                {currentStep?.question && !lastAnswer ? "Answer to continue" : "Next Step →"}
              </Button>
              <Button
                variant={autoPlay ? "primary" : "ghost"}
                size="sm"
                onClick={() => setAutoPlay((v) => !v)}
              >
                {autoPlay ? "⏸ Auto-Playing" : "▶ Auto-Play"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => engine.restart()}>
                ⟲ Restart
              </Button>
            </div>
          )}
        </div>

        {/* SIDEBAR */}
        <div className="space-y-4">
          <PacketInspector packet={activePacket} />
          <TCPStatePanel tcpState={state.tcp.state} />
          <ARPTableViewer title="Laptop" entries={state.arpTable.laptop ?? {}} />
          <MACTableViewer title="Switch" entries={state.macTable.switch ?? {}} />
          <RouteTableViewer title="Router" routes={state.routingTable.router ?? []} />
        </div>
      </div>
    </div>
  );
}

const TCP_STATES = ["CLOSED", "SYN_SENT", "SYN_RECEIVED", "ESTABLISHED"];

function TCPStatePanel({ tcpState }: { tcpState: string }) {
  return (
    <GlassPanel className="p-4">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">TCP State</h4>
      <div className="flex flex-wrap gap-1.5">
        {TCP_STATES.map((s) => (
          <span
            key={s}
            className={clsx(
              "rounded-md border px-2 py-1 pv-mono text-[10px]",
              s === tcpState ? "border-pv-success/50 bg-pv-success/10 text-pv-success" : "border-pv-border text-pv-text-faint",
            )}
          >
            {s}
          </span>
        ))}
      </div>
    </GlassPanel>
  );
}
