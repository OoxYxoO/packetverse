"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  ARCHITECTURES,
  ARCHITECTURE_LABEL,
  ARCHITECTURE_PROFILES,
  CE_MAC,
  L2VPN_EVOLUTION_XP_AWARD,
  STEP_IDX,
  TERMS,
  createL2vpnEvolutionState,
  describeArchitecture,
  evaluateRequirements,
  getStateOwnership,
  hvplsSplitHorizonDemo,
  l2vpnEvolutionSteps,
  labelBlockRecapRows,
  mobilityComparisonDemo,
  multihomingComparisonDemo,
  scalingComparisonRows,
  serviceTopology,
  topologyFor,
  type Architecture,
  type L2vpnEvolutionState,
  type Requirement,
  type RouterId,
} from "@/lib/sim-engine/scenarios/l2vpnEvolution";
import { GraphTopologyViewer } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { ForwardingDecisionCard } from "@/components/protocol/ForwardingDecisionCard";
import { EthernetFdbViewer } from "@/components/protocol/EthernetFdbViewer";
import { EvpnRibViewer, type EvpnRibRow } from "@/components/protocol/EvpnRouteTable";
import { ArchitectureComparisonViewer, type ArchitectureComparisonRow } from "@/components/protocol/ArchitectureComparisonViewer";
import { StateOwnershipViewer } from "@/components/protocol/StateOwnershipViewer";
import { TroubleshootingLayers, type DiagnosticLayer } from "@/components/protocol/TroubleshootingLayers";
import { TopologyModeSwitcher } from "@/components/network3d/TopologyModeSwitcher";
import { PredictionQuestion } from "@/components/quiz/PredictionQuestion";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useProgressStore } from "@/lib/state/useProgressStore";
import { explainNode } from "./explain";
import { traceFor } from "./deviceTrace";

type ViewMode = "physical" | "control" | "service" | "reachability";
const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: "physical", label: "Physical" },
  { value: "control", label: "Control Plane" },
  { value: "service", label: "Service" },
  { value: "reachability", label: "Reachability" },
];

const CHALLENGE_REQUIREMENTS: Requirement[] = ["multipoint", "native-multihoming", "fast-mac-mobility", "control-plane-mac-ip"];

export default function L2vpnEvolutionDemo() {
  const { engine, snapshot } = useScenarioEngine<L2vpnEvolutionState>(createL2vpnEvolutionState(), l2vpnEvolutionSteps);
  const [manualArchitecture, setManualArchitecture] = useState<Architecture | undefined>(undefined);
  const [viewMode, setViewMode] = useState<ViewMode>("physical");
  const [selectedNodeId, setSelectedNodeId] = useState<RouterId | undefined>(undefined);
  const [packetSelected, setPacketSelected] = useState(false);

  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();

  // Auto-follows the arc as it progresses; a manual selector click
  // overrides this until Restart, so the learner can still freely
  // browse any architecture at any time.
  const autoArchitecture: Architecture = useMemo(() => {
    if (index >= STEP_IDX.evpnTransitionQuestion) return "EVPN";
    if (index >= STEP_IDX.hvplsTopology) return "H_VPLS";
    if (index >= STEP_IDX.bgpVplsIntro) return "BGP_VPLS";
    if (index >= STEP_IDX.vplsTopology) return "VPLS";
    return "VPWS";
  }, [index]);
  const selectedArchitecture = manualArchitecture ?? autoArchitecture;
  const setSelectedArchitecture = (a: Architecture) => setManualArchitecture(a);

  useEffect(() => {
    if (isComplete) {
      completeLesson("l2vpn-evolution", L2VPN_EVOLUTION_XP_AWARD);
      unlockAchievement("l2vpn-architect");
    }
  }, [isComplete, completeLesson, unlockAchievement]);

  const handleAnswer = (optionId: string) => {
    if (!currentStep?.question) return;
    const correct = optionId === currentStep.question.correctOptionId;
    engine.answer(optionId);
    recordAnswer(correct);
  };

  const handleRestart = () => {
    engine.restart();
    setManualArchitecture(undefined);
    setViewMode("physical");
    setSelectedNodeId(undefined);
    setPacketSelected(false);
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Resolve the incident to continue" : "Next Step →";

  const topology = viewMode === "control" && selectedArchitecture === "BGP_VPLS" ? topologyFor("BGP_VPLS") : viewMode === "service" ? serviceTopology() : topologyFor(selectedArchitecture);
  const nodeById = useMemo(() => Object.fromEntries(topology.nodes.map((n) => [n.id, n])), [topology]);

  const profile = describeArchitecture(selectedArchitecture);

  const comparisonRows: ArchitectureComparisonRow[] = ARCHITECTURES.map((a) => ({ ...ARCHITECTURE_PROFILES[a], architecture: ARCHITECTURE_LABEL[a], highlighted: a === selectedArchitecture }));

  const incidentLayers: DiagnosticLayer[] = [
    { label: "BGP session (PE1↔RR1↔PE3)", status: "healthy" },
    { label: "VPLS address family", status: "healthy" },
    { label: "Route Target import", status: "healthy" },
    { label: "PE3 membership discovered", status: "healthy" },
    { label: "Label-block coverage", status: "healthy" },
    { label: "Derived service label", status: "healthy" },
    { label: "Service adjacency PE1↔PE3", status: "healthy" },
    { label: "CE3 BGP-VPLS MAC route", status: "unknown" },
    { label: "CE3 FDB entry at PE1", status: state.incident.resolved ? "healthy" : "failing" },
    { label: "Unknown-unicast flooding (expected until learned)", status: state.incident.resolved ? "healthy" : "unknown" },
  ];

  const evpnRows: EvpnRibRow[] = [
    ...state.type2Routes.map((r): EvpnRibRow => ({ routeType: "2", summary: `${r.mac} / ${r.ip}`, nextHop: r.originPe, rd: r.rd, rt: r.rt })),
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <Link href="/dashboard" className="text-sm text-pv-text-faint hover:text-pv-text">
          ← Dashboard
        </Link>
        <Badge tone="violet">CUST-A · L2VPN Evolution Capstone</Badge>
      </div>

      <h1 className="mb-2 text-2xl font-bold text-pv-text">L2VPN Evolution: VPWS → VPLS → BGP-VPLS → H-VPLS → EVPN</h1>
      <p className="mb-6 text-sm text-pv-text-muted">If all five can provide a Layer-2 service, why do all five exist? One customer, five architectures, compared on the same questions every time.</p>

      {/* Step rail */}
      <div className="mb-6 flex gap-1">
        {l2vpnEvolutionSteps.map((step, i) => (
          <button
            key={step.id}
            type="button"
            disabled={i > index}
            onClick={() => i < index && engine.goTo(i)}
            title={step.label}
            className={clsx("h-1.5 flex-1 min-w-1 rounded-full transition-colors", i < index ? "bg-pv-success/70 hover:bg-pv-success cursor-pointer" : i === index ? "bg-pv-cyan" : "bg-white/10")}
          />
        ))}
      </div>

      {isComplete ? (
        <GlassPanel strong className="p-8 text-center">
          <h2 className="mb-3 text-xl font-bold text-pv-success">L2VPN Architect</h2>
          <p className="mb-4 text-sm text-pv-text-muted">
            BGP-VPLS changes how the VPLS is discovered and signaled; H-VPLS changes how the VPLS is structured; EVPN changes how Ethernet reachability itself is distributed. +{L2VPN_EVOLUTION_XP_AWARD} XP awarded.
          </p>
          <Button onClick={handleRestart}>Restart Lesson</Button>
        </GlassPanel>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-5">
            {/* Narrative */}
            <GlassPanel strong className="p-5">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">{currentStep?.label}</h3>
              <p className="text-sm leading-relaxed text-pv-text">{currentStep?.narrative}</p>
              {whatChanged.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-pv-border pt-3">
                  {whatChanged.map((w, i) => (
                    <li key={i} className="pv-mono text-[11px] text-pv-cyan-soft">
                      → {w}
                    </li>
                  ))}
                </ul>
              )}
            </GlassPanel>

            {/* Topology */}
            <GlassPanel className="p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <TopologyModeSwitcher options={ARCHITECTURES.map((a) => ({ value: a, label: ARCHITECTURE_LABEL[a] }))} value={selectedArchitecture} onChange={(v) => setSelectedArchitecture(v as Architecture)} tone="cyan" />
                <TopologyModeSwitcher options={VIEW_OPTIONS} value={viewMode} onChange={(v) => setViewMode(v as ViewMode)} tone="violet" />
              </div>
              <GraphTopologyViewer nodes={topology.nodes} edges={topology.edges.map((e) => ({ ...e, state: "full" as const }))} activeNodeIds={activePacket ? [activePacket.from, activePacket.to] : []} onNodeClick={(id) => setSelectedNodeId(id as RouterId)}>
                {activePacket && nodeById[activePacket.from] && nodeById[activePacket.to] && (
                  <GraphPacket packet={activePacket} from={{ x: nodeById[activePacket.from].x, y: nodeById[activePacket.from].y }} to={{ x: nodeById[activePacket.to].x, y: nodeById[activePacket.to].y }} onSelect={() => setPacketSelected(true)} />
                )}
              </GraphTopologyViewer>
            </GlassPanel>

            {packetSelected && activePacket && (
              <div>
                <div className="mb-1 flex justify-end">
                  <button type="button" onClick={() => setPacketSelected(false)} className="text-xs text-pv-text-faint hover:text-pv-text">
                    close
                  </button>
                </div>
                <PacketInspector packet={activePacket} />
              </div>
            )}

            {selectedNodeId && (
              <GlassPanel className="p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{selectedNodeId}</h4>
                  <button type="button" onClick={() => setSelectedNodeId(undefined)} className="text-xs text-pv-text-faint hover:text-pv-text">
                    close
                  </button>
                </div>
                <NodeExplanationPanel state={state} nodeId={selectedNodeId} />
              </GlassPanel>
            )}

            {/* FDB — VPLS / BGP-VPLS lanes */}
            {(selectedArchitecture === "VPLS" || selectedArchitecture === "BGP_VPLS") && (
              <div className="grid gap-3 sm:grid-cols-3">
                {(["PE1", "PE2", "PE3"] as const).map((pe) => (
                  <EthernetFdbViewer key={pe} title={pe} rows={state.fdb[pe].map((e) => ({ mac: e.mac, portKind: e.port.kind, portPeer: e.port.peer }))} />
                ))}
              </div>
            )}

            {(currentStep?.id === "vpls-first-frame-unknown" || currentStep?.id === "vpls-known-unicast" || currentStep?.id === "verify-dataplane") && state.journey.length > 0 && (
              <ForwardingDecisionCard router={state.journey[state.journey.length - 1].device} input={state.journey[state.journey.length - 1].input} lookup={state.journey[state.journey.length - 1].lookup} action={state.journey[state.journey.length - 1].action} output={state.journey[state.journey.length - 1].output} />
            )}

            {currentStep?.id.startsWith("incident-") && <TroubleshootingLayers title="Diagnostic Ladder" layers={incidentLayers} />}

            {currentStep?.id === "bgp-vpls-label-block-recap" && (
              <GlassPanel className="p-4">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Label = Label Base + VE-ID − VBO</h4>
                <div className="space-y-1">
                  {labelBlockRecapRows().map((r) => (
                    <div key={r.label} className="flex justify-between pv-mono text-[11px] text-pv-text-muted">
                      <span>{r.label}</span>
                      <span className="text-pv-text">{r.value}</span>
                    </div>
                  ))}
                </div>
              </GlassPanel>
            )}

            {currentStep?.id === "hvpls-scaling-comparison" && (
              <GlassPanel className="p-4">
                {scalingComparisonRows(10).map((r) => (
                  <div key={r.label} className="flex justify-between pv-mono text-[11px] text-pv-text-muted">
                    <span>{r.label}</span>
                    <span className="text-pv-text">{r.value}</span>
                  </div>
                ))}
              </GlassPanel>
            )}

            {currentStep?.id === "hvpls-split-horizon" && (
              <GlassPanel className="p-4">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Hierarchical Split Horizon (live)</h4>
                {hvplsSplitHorizonDemo().map((r, i) => (
                  <div key={i} className="mb-2 rounded-lg border border-pv-border p-2 text-[11px]">
                    <div className="pv-mono text-pv-text">Ingress: {r.ingress}</div>
                    <div className="pv-mono text-pv-text-faint">Allowed egress: {r.allowed}</div>
                    <Badge tone="cyan">{r.decision}</Badge>
                  </div>
                ))}
              </GlassPanel>
            )}

            {(currentStep?.id === "evpn-ce3-install" || currentStep?.id === "evpn-type2-recap" || currentStep?.id === "evpn-vs-traditional-signature") && <EvpnRibViewer title="CUST-A" rows={evpnRows} />}

            {currentStep?.id === "evpn-mac-mobility-comparison" && (
              <GlassPanel className="p-4">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Reused From EVPN MAC Mobility Lesson</h4>
                {(() => {
                  const { before, after, selected } = mobilityComparisonDemo();
                  return (
                    <div className="space-y-1 pv-mono text-[11px] text-pv-text-muted">
                      <div>Old advertisement (representing PE1): seq {before.mobilitySeq}</div>
                      <div>New advertisement (representing PE2): seq {after.mobilitySeq}</div>
                      <div className="text-pv-success">Winner: seq {selected.mobilitySeq} — higher sequence always wins</div>
                    </div>
                  );
                })()}
              </GlassPanel>
            )}

            {currentStep?.id === "evpn-multihoming-comparison" && (
              <GlassPanel className="p-4">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Reused From EVPN Multihoming Lesson — CE-DUAL</h4>
                {(() => {
                  const { dfState, roleByLeaf } = multihomingComparisonDemo();
                  return (
                    <div className="space-y-1 pv-mono text-[11px] text-pv-text-muted">
                      <div>{dfState.reason}</div>
                      <div>PE1 (as LEAF1): {roleByLeaf.LEAF1}</div>
                      <div>PE2 (as LEAF2): {roleByLeaf.LEAF2}</div>
                    </div>
                  );
                })()}
              </GlassPanel>
            )}

            {currentStep?.id === "architecture-comparison-table" && <ArchitectureComparisonViewer rows={comparisonRows} />}
            {currentStep?.id === "state-ownership-table" && <StateOwnershipViewer rows={getStateOwnership()} />}

            {currentStep?.id === "engineer-challenge" && (
              <GlassPanel className="p-4">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Requirement Match — EVPN</h4>
                {evaluateRequirements("EVPN", CHALLENGE_REQUIREMENTS).map((r) => (
                  <div key={r.requirement} className="flex justify-between pv-mono text-[11px] text-pv-text-muted">
                    <span>{r.requirement}</span>
                    <Badge tone={r.status === "supported" ? "success" : r.status === "partial" ? "warning" : "danger"}>{r.status}</Badge>
                  </div>
                ))}
              </GlassPanel>
            )}

            {!currentStep?.question && currentStep?.id === "repair-challenge" && (
              <IncidentRepairChallenge attempt={state.incident.repairAttempt} onTry={(choice) => engine.act({ choice })} />
            )}

            {currentStep?.question && <PredictionQuestion question={currentStep.question} selectedOptionId={lastAnswer?.stepId === currentStep.id ? lastAnswer.optionId : undefined} onAnswer={handleAnswer} />}

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" size="sm" onClick={() => engine.goTo(Math.max(0, index - 1))} disabled={index === 0}>
                ← Previous
              </Button>
              <Button size="sm" onClick={() => engine.advance()} disabled={!canAdvance}>
                {nextLabel}
              </Button>
              <Button variant="secondary" size="sm" onClick={handleRestart}>
                Restart
              </Button>
              <span className="pv-mono text-xs text-pv-text-faint">
                Step {index + 1} / {totalSteps}
              </span>
            </div>
          </div>

          {/* Right rail */}
          <div className="space-y-4">
            <GlassPanel strong className="p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-violet">{ARCHITECTURE_LABEL[selectedArchitecture]}</h4>
              <dl className="space-y-2 text-[11px]">
                <Row label="Service Type" value={profile.serviceType} />
                <Row label="Discovery" value={profile.discovery} />
                <Row label="Signaling" value={profile.signaling} />
                <Row label="MAC Reachability" value={profile.macReachability} />
                <Row label="BUM" value={profile.bum} />
                <Row label="Split Horizon" value={profile.splitHorizon} />
                <Row label="Multihoming" value={profile.multihomingModel} />
                <Row label="Access Hierarchy" value={profile.accessHierarchy} />
              </dl>
            </GlassPanel>

            <GlassPanel className="p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">CUST-A Sites</h4>
              <div className="space-y-1 pv-mono text-[11px] text-pv-text-muted">
                <div>CE1 — {CE_MAC.CE1}</div>
                <div>CE2 — {CE_MAC.CE2}</div>
                <div>CE3 — {CE_MAC.CE3}</div>
              </div>
            </GlassPanel>

            <GlassPanel className="p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Terms</h4>
              <div className="space-y-2">
                {TERMS.map((t) => (
                  <div key={t.term} className="text-[11px]">
                    <span className="pv-mono font-semibold text-pv-cyan-soft">{t.term}</span>
                    <span className="text-pv-text-faint"> — {t.expansion}. </span>
                    <span className="text-pv-text-muted">{t.meaning}</span>
                  </div>
                ))}
              </div>
            </GlassPanel>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-pv-text-faint uppercase tracking-wide">{label}</dt>
      <dd className="pv-mono text-pv-text">{value}</dd>
    </div>
  );
}

function NodeExplanationPanel({ state, nodeId }: { state: L2vpnEvolutionState; nodeId: RouterId }) {
  const explanation = explainNode(state, nodeId);
  const trace = traceFor(nodeId, state);
  return (
    <div className="space-y-2 text-[11px]">
      <p className="text-pv-text-faint">{explanation.deviceType}</p>
      <p className="text-pv-text">{explanation.role}</p>
      {explanation.controlPlaneRole && <p className="text-pv-cyan-soft">Control: {explanation.controlPlaneRole}</p>}
      {explanation.dataPlaneRole && <p className="text-pv-violet">Data: {explanation.dataPlaneRole}</p>}
      <p className="pv-mono text-pv-text-muted">{explanation.currentAction}</p>
      {trace?.stages && (
        <div className="mt-2 flex flex-wrap gap-1">
          {trace.stages.map((s) => (
            <Badge key={s.id} tone={trace.completedStageIds.includes(s.id) ? "success" : trace.activeStageId === s.id ? "cyan" : "muted"}>
              {s.label}
            </Badge>
          ))}
        </div>
      )}
      {explanation.tables?.map((t) => (
        <div key={t.title} className="mt-2">
          <p className="mb-1 text-pv-text-faint uppercase tracking-wide">{t.title}</p>
          {t.rows.map((r) => (
            <div key={r.label} className="flex justify-between pv-mono text-pv-text-muted">
              <span>{r.label}</span>
              <span className="text-pv-text">{r.value}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const WRONG_REPAIR_FEEDBACK: Record<string, string> = {
  "restart-bgp": "Restarting BGP fixes nothing here — the session, the address family, and RT import were already healthy. BGP-VPLS's NLRI was never designed to carry a customer MAC in the first place, so there is no missing route a restart could surface.",
  "add-evpn-type2-manually": "This is BGP-signaled VPLS, not EVPN — there is no Type 2 AFI/SAFI running in this service. Manually injecting an EVPN route into a BGP-VPLS deployment does not do anything for this service's forwarding.",
  "change-vpls-rt": "The Route Target already matches — membership, label-block coverage, and the service adjacency are all already healthy. Changing an RT that isn't broken risks breaking real membership for no benefit.",
};
const REPAIR_OPTIONS = [
  { id: "observe-traffic", label: "No configuration change — let CE3 send traffic so PE1 learns its MAC from the data plane" },
  { id: "restart-bgp", label: "Restart BGP because CE3's MAC is absent" },
  { id: "add-evpn-type2-manually", label: "Manually add an EVPN Type 2 route for CE3" },
  { id: "change-vpls-rt", label: "Change the VPLS Route Target" },
];
function IncidentRepairChallenge({ attempt, onTry }: { attempt?: { choice: string; correct: boolean }; onTry: (choice: string) => void }) {
  return (
    <GlassPanel strong className="p-5">
      <p className="mb-3 text-sm font-medium text-pv-text">Choose how to proceed:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {REPAIR_OPTIONS.map((opt) => {
          const isSelected = attempt?.choice === opt.id;
          const isCorrect = opt.id === "observe-traffic";
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
        <div className={clsx("mt-4 rounded-xl border p-4 text-sm", attempt.correct ? "border-pv-success/50 bg-pv-success/10 text-pv-success" : "border-pv-warning/40 bg-pv-warning/5 text-pv-text-muted")}>
          {attempt.correct ? (
            <span className="font-semibold">✓ Correct — this was never a configuration fault. CE3&apos;s MAC is now learned from real customer traffic.</span>
          ) : (
            <>
              <span className="mb-1 block font-semibold text-pv-text">That doesn&apos;t fix anything, because nothing was broken.</span>
              {WRONG_REPAIR_FEEDBACK[attempt.choice] ?? "Try again."}
            </>
          )}
        </div>
      )}
    </GlassPanel>
  );
}
