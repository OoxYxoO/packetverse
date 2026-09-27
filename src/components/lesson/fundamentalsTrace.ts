import type { DeviceProcessingTrace, PacketMutation, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";

/**
 * Shared hop-record shape for the Fundamentals lessons (Ethernet, IPv4, VLANs). Each scenario appends one of these to
 * its own state every time a device processes something, so the device trace for ANY step — live or historical —
 * is re-described from the state that step produced, never recomputed.
 */
export interface FundHop {
  stepId: string;
  device: string;
  /** Stage table for this kind of processing on this device. */
  stages: ProcessingStage[];
  activeStageId: string;
  ingressInterfaceId?: string;
  egressInterfaceId?: string;
  /** Every egress port when the device floods (the trace's single egress field shows the first). */
  egressInterfaceIds?: string[];
  lookupType: string;
  lookupKey: string;
  lookupResult: string;
  /** Short verb shown in the journey timeline, e.g. "LEARN + FLOOD". */
  action: string;
  reason: string;
  input: string;
  output: string;
  nextHopId?: string;
  before?: PacketStackFrame[];
  after?: PacketStackFrame[];
  mutations?: PacketMutation[];
}

/** The trace for `device` at `stepId`: its own hop for that step if it acted, otherwise an idle trace over `idleStages`. */
export function traceFromHops(device: string, hops: FundHop[], stepId: string, idleStages: ProcessingStage[]): DeviceProcessingTrace {
  const hop = [...hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  if (!hop) return { deviceId: device, stages: idleStages, completedStageIds: [] };
  const activeIdx = hop.stages.findIndex((s) => s.id === hop.activeStageId);
  return {
    deviceId: device,
    stages: hop.stages,
    activeStageId: hop.activeStageId,
    completedStageIds: hop.stages.slice(0, Math.max(0, activeIdx)).map((s) => s.id),
    ingressInterfaceId: hop.ingressInterfaceId,
    egressInterfaceId: hop.egressInterfaceId,
    packetBefore: hop.input,
    packetAfter: hop.output,
    forwardingAction: hop.action,
    lookupType: hop.lookupType,
    lookupKey: hop.lookupKey,
    lookupResult: hop.lookupResult,
    nextHopId: hop.nextHopId,
    nextHopLabel: hop.nextHopId,
    reason: hop.reason,
    packetBeforeFrames: hop.before,
    packetAfterFrames: hop.after,
    mutations: hop.mutations,
  };
}
