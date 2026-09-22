import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketMutation, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { fmtIpv6, type Hextets } from "@/lib/sim-engine/scenarios/srv6Foundations";
import { BEHAVIOR_LABEL } from "@/lib/sim-engine/scenarios/srv6EndpointBehaviors";
import {
  ALL_ROUTERS,
  BASE_PROGRAM,
  computeIgpShortestPath,
  computeNextCsidCapacity,
  CSID_CUST_HOST,
  csidHexText,
  ENDX_PROGRAM,
  executeEndDt4Decap,
  HEADEND,
  LINKS,
  liveStructures,
  LOCATOR_BLOCK_HEXTETS,
  LOCATOR_BLOCK_TEXT,
  NEXT_CSID_LAYOUT,
  NEXT_CSID_VALUE,
  ordinarySidText,
  REPLACE_CSID_LAYOUT,
  REPLACE_PROGRAM,
  srv6CsidSteps,
  validateSidStructureForCompression,
  type CsidJourneyHop,
  type CsidPacketState,
  type LinkDef,
  type RouterId,
  type Srv6CsidState,
} from "@/lib/sim-engine/scenarios/srv6Csid";

/**
 * Scene Adapter for SRv6 CSID (ARCHITECTURE.md §4/§7/§18). Every value
 * below is re-described FROM Srv6CsidState — the scenario's own
 * executeNextCsidAdvance/executeReplaceCsidAdvance results recorded on
 * each CsidJourneyHop (DA before/after, Segments Left before/after, Hop
 * Limit, forced End.X adjacency, reason). No shift, boundary crossing,
 * Index advance, or SRH change is ever recomputed here.
 *
 * Physical vs. logical: a compressed CSID sequence is NOT a hop list.
 * The physical path is derived from the scenario's own
 * computeIgpShortestPath() between consecutive instruction owners (or
 * the recorded End.X `forwardVia` adjacency), so REPLACE-CSID's R4 → R8
 * segment correctly traverses R5/R6/R7 as ordinary IPv6 transit
 * routers, and ingress/egress interfaces always come from real,
 * topology-validated neighbors — never from consecutive CSID owners and
 * never from a static nbrs[0]/nbrs[1] pick.
 */

const stepIndex = (id: string) => srv6CsidSteps.findIndex((s) => s.id === id);
function inRange(stepId: string, fromId: string, toId: string): boolean {
  const i = stepIndex(stepId);
  return i !== -1 && i >= stepIndex(fromId) && i <= stepIndex(toId);
}

/** REPLACE-CSID lab (uses state.replacePacket / state.replaceJourney) — same range the page has always used. */
export function isReplacePhase(stepId: string): boolean {
  return inRange(stepId, "replace-csid-intro", "predict-dt4-replace-defined");
}

// ---------------------------------------------------------------------------
// Walks — the three packet journeys the scenario actually executes. Outside
// these ranges a router's last recorded hop is history from an earlier lab,
// not current processing, so no hop facts are shown (step-aware traces).
// ---------------------------------------------------------------------------

interface Walk {
  hops: CsidJourneyHop[];
  packet?: CsidPacketState;
  at?: RouterId;
}
export function walkFor(state: Srv6CsidState, stepId: string): Walk | undefined {
  if (inRange(stepId, "r1-imposes", "r7-r8-finish") || inRange(stepId, "endx-walk", "endx-r8-final")) return { hops: state.journey, packet: state.packet, at: state.packetAt };
  if (inRange(stepId, "replace-advance-walk", "replace-dt4-execute")) {
    const last = state.replaceJourney[state.replaceJourney.length - 1];
    return { hops: state.replaceJourney, packet: state.replacePacket, at: last?.router };
  }
  return undefined;
}

/** The packet this step is about (REPLACE lab vs. every other lab). */
export function phasePacketFor(state: Srv6CsidState, stepId: string): CsidPacketState | undefined {
  return isReplacePhase(stepId) ? state.replacePacket : state.packet;
}

/** Where the packet physically is right now — the scenario's own packetAt, except the REPLACE walk (which records owners only). */
export function packetLocationFor(state: Srv6CsidState, stepId: string): RouterId | undefined {
  if (isReplacePhase(stepId)) {
    const last = state.replaceJourney[state.replaceJourney.length - 1];
    return last?.router ?? (state.replacePacket ? HEADEND : undefined);
  }
  return state.packetAt;
}

function linkBetween(links: LinkDef[], a: RouterId, b: RouterId): LinkDef | undefined {
  return links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
}

/**
 * Physical routers traversed so far in the current walk: headend →
 * IGP shortest path to each recorded instruction owner (or the owner's
 * recorded End.X adjacency) → the scenario's current packetAt.
 */
export function physicalPathFor(state: Srv6CsidState, stepId: string): RouterId[] {
  const walk = walkFor(state, stepId);
  if (!walk) return [];
  const targets = walk.hops.map((h) => h.router);
  if (walk.at && walk.at !== HEADEND && walk.at !== targets[targets.length - 1]) targets.push(walk.at);
  const path: RouterId[] = [HEADEND];
  let forced: RouterId | undefined;
  for (let i = 0; i < targets.length; i++) {
    let from = path[path.length - 1];
    if (forced && forced !== from && linkBetween(state.links, from, forced)) {
      path.push(forced);
      from = forced;
    }
    forced = undefined;
    if (from !== targets[i]) {
      const sp = computeIgpShortestPath(state.links, from, targets[i]);
      if (!sp) break;
      path.push(...sp.path.slice(1));
    }
    const hop = walk.hops[i];
    if (hop && hop.router === targets[i]) forced = hop.forwardVia;
  }
  return path;
}

export function physicalLinkIdsFor(state: Srv6CsidState, stepId: string): Set<string> {
  const path = physicalPathFor(state, stepId);
  const ids = new Set<string>();
  for (let i = 0; i < path.length - 1; i++) {
    const l = linkBetween(state.links, path[i], path[i + 1]);
    if (l) ids.add(l.id);
  }
  return ids;
}

/**
 * The real physical link to animate for a step's packet. Fast-forward
 * steps (R3→R6, R6→R8, R1→R6, R2→R8) name two non-adjacent routers; they
 * are drawn on the final physical link INTO the destination, never as a
 * straight line implying adjacency. Same-router events (from === to)
 * stay on one router and never create a link.
 */
export function animatedHopFor(packet: PacketVisual | undefined, state: Srv6CsidState, stepId: string): { fromId: RouterId; toId: RouterId } | undefined {
  if (!packet) return undefined;
  const from = packet.from as RouterId;
  const to = packet.to as RouterId;
  if (from === to) return { fromId: from, toId: to };
  // The walk's physical path wins even when from/to happen to share a
  // link: R6→R8 in the base walk travels R6-R7-R8, never the unused
  // metric-50 R6-R8 alternate.
  const path = physicalPathFor(state, stepId);
  const idx = path.lastIndexOf(to);
  if (idx > 0) return { fromId: path[idx - 1], toId: to };
  if (linkBetween(state.links, from, to)) return { fromId: from, toId: to };
  return undefined;
}

// ---------------------------------------------------------------------------
// Owners / labels
// ---------------------------------------------------------------------------

function lblHextets(hop: CsidJourneyHop): number {
  return (hop.flavor === "NEXT_CSID" ? NEXT_CSID_LAYOUT : REPLACE_CSID_LAYOUT).lblBits / 16;
}
/** The router owning a Locator-Node/CSID value — a reverse read of the scenario's own NEXT_CSID_VALUE allocation. */
function ownerOfCsid(value: number): RouterId | undefined {
  return ALL_ROUTERS.find((r) => NEXT_CSID_VALUE[r] === value);
}
function activeCsidOf(da: Hextets, lbl: number): number {
  return da[lbl];
}
function behaviorText(hop: CsidJourneyHop): string {
  return `${BEHAVIOR_LABEL[hop.behavior]} + ${hop.flavor === "NEXT_CSID" ? "NEXT-CSID" : "REPLACE-CSID"}`;
}
function describeDa(da: Hextets, flavor: CsidJourneyHop["flavor"]): string {
  if (flavor === "REPLACE_CSID") return `${fmtIpv6(da)} (CSID ${csidHexText(da[3])}/${csidHexText(da[4])}, Index ${da[7]})`;
  return `${fmtIpv6(da)} (active CSID ${csidHexText(da[NEXT_CSID_LAYOUT.lblBits / 16])})`;
}

// ---------------------------------------------------------------------------
// Interfaces — one per real LINKS entry. Ids are router-scoped and only
// produced for a neighbor the topology actually connects.
// ---------------------------------------------------------------------------

function ifaceId(router: RouterId, neighbor: RouterId | undefined, links: LinkDef[] = LINKS): string | undefined {
  if (!neighbor || neighbor === router || !linkBetween(links, router, neighbor)) return undefined;
  return `${router}:${neighbor}`;
}

// ---------------------------------------------------------------------------
// Packet frames — a reshape of CsidPacketState / recorded hop facts.
// ---------------------------------------------------------------------------

function framesForPacket(pkt: CsidPacketState | undefined, flavor: CsidJourneyHop["flavor"]): PacketStackFrame[] | undefined {
  if (!pkt) return undefined;
  const frames: PacketStackFrame[] = [{ id: "ipv6", text: `IPv6 DA ${describeDa(pkt.daHextets, flavor)} · HL ${pkt.hopLimit}`, tone: "ip" }];
  if (pkt.srh) frames.push({ id: "srh", text: `SRH SL=${pkt.srh.segmentsLeft} LE=${pkt.srh.lastEntry} (${pkt.srh.segmentList.length} × 128-bit entries)`, tone: "transport" });
  frames.push({ id: "payload", text: "Payload", tone: "generic" });
  return frames;
}
function hopFrames(hop: CsidJourneyHop, side: "before" | "after", lastEntry: number | undefined): PacketStackFrame[] {
  const da = side === "before" ? hop.daBefore : hop.daAfter;
  const sl = side === "before" ? hop.segmentsLeftBefore : hop.segmentsLeftAfter;
  const hl = side === "before" ? hop.hopLimitBefore : hop.hopLimitAfter;
  const daChanged = side === "after" && fmtIpv6(hop.daBefore) !== fmtIpv6(hop.daAfter);
  const frames: PacketStackFrame[] = [{ id: "ipv6", text: `IPv6 DA ${describeDa(da, hop.flavor)} · HL ${hl}`, tone: "ip", justChanged: daChanged }];
  if (sl !== undefined) frames.push({ id: "srh", text: `SRH SL=${sl}${lastEntry !== undefined ? ` LE=${lastEntry}` : ""}`, tone: "transport", justChanged: side === "after" && hop.segmentsLeftBefore !== hop.segmentsLeftAfter });
  frames.push({ id: "payload", text: "Payload", tone: "generic" });
  return frames;
}
function packetText(da: Hextets, sl: number | undefined, hl: number): string {
  return `DA=${fmtIpv6(da)} · ${sl === undefined ? "no SRH" : `SL=${sl}`} · HL=${hl}`;
}

function hopMutations(hop: CsidJourneyHop): PacketMutation[] {
  const lbl = lblHextets(hop);
  const out: PacketMutation[] = [];
  const before = activeCsidOf(hop.daBefore, lbl);
  const after = activeCsidOf(hop.daAfter, lbl);
  if (fmtIpv6(hop.daBefore) !== fmtIpv6(hop.daAfter)) {
    let detail: string;
    if (hop.action === "INTRA_CONTAINER_SHIFT") detail = `Argument shifted left after the Locator-Block: CSID ${csidHexText(before)} consumed, ${csidHexText(after)} now active, low slot zero-padded`;
    else if (hop.action === "CONTAINER_BOUNDARY_CROSSED" && hop.flavor === "NEXT_CSID") detail = `Container exhausted — Segment List[${hop.segmentsLeftAfter}] copied into the DA; ${csidHexText(after)} now active`;
    else if (hop.action === "CONTAINER_BOUNDARY_CROSSED") detail = `Packed container Segment List[${hop.segmentsLeftAfter}] loaded; valid SID reconstructed from its first position (CSID ${csidHexText(after)}/${csidHexText(hop.daAfter[4])}, Index ${hop.daAfter[7]})`;
    else detail = `Valid SID reconstructed from packed position ${hop.daBefore[7]} (CSID ${csidHexText(after)}/${csidHexText(hop.daAfter[4])}), Index ${hop.daBefore[7]} → ${hop.daAfter[7]}`;
    out.push({ type: "DA_CHANGE", detail });
  }
  if (hop.segmentsLeftBefore !== hop.segmentsLeftAfter) out.push({ type: "SEGMENTS_LEFT_CHANGE", detail: `Segments Left ${hop.segmentsLeftBefore} → ${hop.segmentsLeftAfter} (a new 128-bit Segment List entry was consumed)` });
  if (hop.hopLimitBefore !== hop.hopLimitAfter) out.push({ type: "HOP_LIMIT_CHANGE", detail: `Hop Limit ${hop.hopLimitBefore} → ${hop.hopLimitAfter}` });
  return out;
}

// ---------------------------------------------------------------------------
// Stage lists
// ---------------------------------------------------------------------------

const HEADEND_STAGES: ProcessingStage[] = [
  { id: "select-program", label: "Select Logical Program" },
  { id: "validate-structures", label: "Validate SID Structures" },
  { id: "compress", label: "Compress Eligible Runs" },
  { id: "construct-packet", label: "Construct DA + SRH" },
  { id: "forward", label: "IPv6 FIB → Egress" },
];
const TRANSIT_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "ipv6-fib", label: "IPv6 FIB (not a local SID)" },
  { id: "egress", label: "Egress" },
];
function endpointStages(hop: CsidJourneyHop | undefined, withDt4: boolean, replace: boolean): ProcessingStage[] {
  const advanceLabel =
    hop?.action === "FINAL"
      ? "Sequence Complete"
      : hop?.action === "CONTAINER_BOUNDARY_CROSSED"
        ? replace
          ? "Load Packed Container + Reconstruct"
          : "Load Next Segment List Entry"
        : replace
          ? "Reconstruct SID From Packed Position"
          : "Shift Argument (NEXT-CSID)";
  const stages: ProcessingStage[] = [
    { id: "ingress", label: "Ingress" },
    { id: "match", label: "Local SID Match" },
    { id: "check", label: replace ? "Check Index / Packed Position" : "Check Argument" },
    { id: "advance", label: advanceLabel },
  ];
  if (hop?.action !== "FINAL") stages.push({ id: "forward", label: hop?.forwardVia ? "Forward via End.X Adjacency" : "Forward via IPv6 FIB" });
  if (withDt4) stages.push({ id: "dt4", label: "End.DT4: Decap + IPv4 VRF Lookup" });
  return stages;
}
function before(stages: ProcessingStage[], id: string): string[] {
  const i = stages.findIndex((s) => s.id === id);
  return i === -1 ? stages.map((s) => s.id) : stages.slice(0, i).map((s) => s.id);
}

// ---------------------------------------------------------------------------
// Primary actor per step — drives the active stage, HopTimeline entries,
// and historical deviceForStep. Fast-forward steps name their LAST actor.
// ---------------------------------------------------------------------------

export const PRIMARY_TRANSITION: Partial<Record<string, { router: RouterId; stage: string }>> = {
  "logical-program-intro": { router: "R1", stage: "select-program" },
  "uncompressed-program": { router: "R1", stage: "select-program" },
  "validate-all-structures": { router: "R1", stage: "validate-structures" },
  "compress-first-container": { router: "R1", stage: "compress" },
  "compress-second-container": { router: "R1", stage: "compress" },
  "full-srh-two-containers": { router: "R1", stage: "construct-packet" },
  "r1-imposes": { router: "R1", stage: "construct-packet" },
  "r1-forward": { router: "R1", stage: "forward" },
  "r2-match-execute": { router: "R2", stage: "advance" },
  "r2-forward": { router: "R2", stage: "forward" },
  "r3-r5-shift": { router: "R5", stage: "forward" },
  "r6-boundary-cross": { router: "R6", stage: "advance" },
  "r7-r8-finish": { router: "R8", stage: "advance" },
  "one-container-intro": { router: "R1", stage: "construct-packet" },
  "endx-setup": { router: "R1", stage: "construct-packet" },
  "endx-walk": { router: "R6", stage: "forward" },
  "endx-r8-final": { router: "R8", stage: "advance" },
  "final-service-sid-experiment": { router: "R1", stage: "construct-packet" },
  "diagnostic-ladder": { router: "R1", stage: "validate-structures" },
  "fault-consequence": { router: "R1", stage: "compress" },
  "apply-repair": { router: "R1", stage: "compress" },
  "mandatory-resend": { router: "R1", stage: "construct-packet" },
  "replace-first-container": { router: "R1", stage: "construct-packet" },
  "replace-packed-containers": { router: "R1", stage: "construct-packet" },
  "replace-advance-walk": { router: "R8", stage: "advance" },
  "replace-dt4-execute": { router: "R8", stage: "dt4" },
  "challenge-inject-fault": { router: "R1", stage: "validate-structures" },
  "challenge-verify": { router: "R1", stage: "compress" },
};

/** Explicit per-step primary actor first (every hop is recorded against the router that PERFORMED it), packet sender as fallback. */
export function deviceForStep(stepId: string, packet: PacketVisual | undefined): RouterId | undefined {
  return PRIMARY_TRANSITION[stepId]?.router ?? (packet?.from as RouterId | undefined);
}

// ---------------------------------------------------------------------------
// R1 — headend
// ---------------------------------------------------------------------------

function validationSummary(state: Srv6CsidState): { text: string; failing: string[] } {
  const structures = liveStructures(state);
  const failing: string[] = [];
  for (const r of ALL_ROUTERS) {
    const v = validateSidStructureForCompression(structures[r]);
    if (v.validity !== "VALID") failing.push(`${r} ${v.validity}${v.reason ? ` (${v.reason})` : ""}`);
  }
  return { text: failing.length === 0 ? `All ${ALL_ROUTERS.length} routers VALID` : failing.join("; "), failing };
}
function planText(pkt: CsidPacketState | undefined): string {
  if (!pkt) return "—";
  if (!pkt.srh) return `1 entry — carried entirely in the IPv6 DA, no SRH`;
  const travel = [...pkt.srh.segmentList].reverse().map((s) => s.label);
  return `${pkt.srh.segmentList.length} Segment List entries (travel order): ${travel.join(" → ")}`;
}

function traceForHeadend(state: Srv6CsidState, stepId: string): DeviceProcessingTrace {
  const base: DeviceProcessingTrace = { deviceId: HEADEND, stages: HEADEND_STAGES, completedStageIds: [] };
  const primary = PRIMARY_TRANSITION[stepId];
  if (!primary || primary.router !== HEADEND) return base;
  const replace = isReplacePhase(stepId);
  const pkt = phasePacketFor(state, stepId);
  const flavor = replace ? "REPLACE_CSID" : "NEXT_CSID";
  const firstOwner = pkt ? ownerOfCsid(pkt.daHextets[(replace ? REPLACE_CSID_LAYOUT : NEXT_CSID_LAYOUT).lblBits / 16]) : undefined;
  const firstHop = firstOwner ? computeIgpShortestPath(state.links, HEADEND, firstOwner)?.path[1] : undefined;
  const active = primary.stage;
  const common = { ...base, activeStageId: active, completedStageIds: before(HEADEND_STAGES, active) };

  if (active === "select-program") {
    return { ...common, lookupType: "Logical Program (intent)", lookupResult: `${BASE_PROGRAM.length} segments: ${BASE_PROGRAM.map((s) => `${s.owner} ${BEHAVIOR_LABEL[s.behavior]}`).join(", ")}`, reason: stepId === "uncompressed-program" ? `Uncompressed, every segment is its own 128-bit SID — ${BASE_PROGRAM.length} × 16 bytes of segment-value storage.` : "Compression may change only the encoding of this program, never the program itself." };
  }
  if (active === "validate-structures") {
    const v = validationSummary(state);
    return { ...common, lookupType: "SID Structure Validation (RFC 9800 §6.1)", lookupKey: "LBL ≠ 0 · LNFL ≠ 0 · AL = 128 − LBL − LNL − FL", lookupResult: v.text, reason: v.failing.length ? "An invalid structure is treated exactly like an unknown one: that SID is not compressible and travels as an ordinary SID — it remains reachable." : "Every structure is internally consistent — every segment is eligible for compression." };
  }
  if (active === "compress") {
    const pending = (stepId === "apply-repair" && !state.mainTroubleshooting.correctVerified) || (stepId === "challenge-verify" && !state.challenge.correctVerified);
    if (pending) return { ...common, lookupType: "Compression Plan", lookupResult: "Repair not yet applied — apply it in the panel to recompute", reason: "The plan is recomputed only after the advertised structure is corrected." };
    const capacity = computeNextCsidCapacity(NEXT_CSID_LAYOUT);
    return {
      ...common,
      egressInterfaceId: undefined,
      lookupType: "NEXT-CSID Compression Plan",
      lookupKey: `LBL=${NEXT_CSID_LAYOUT.lblBits}, LNFL=${NEXT_CSID_LAYOUT.lnflBits} → ${capacity} CSIDs per container`,
      lookupResult: planText(pkt),
      reason: stepId === "fault-consequence" ? `${validationSummary(state).text} — that segment breaks the run and travels as an ordinary SID; the rest still compresses.` : stepId === "challenge-verify" ? "Recomputed plan expands back to the identical logical program (equivalence verified)." : "Eligible consecutive segments are packed into containers of at most K CSIDs; every container is one 128-bit value.",
    };
  }
  if (active === "construct-packet") {
    const imposes = stepId === "r1-imposes";
    return {
      ...common,
      egressInterfaceId: imposes ? ifaceId(HEADEND, firstHop, state.links) : undefined,
      packetBefore: `Logical program (${replace ? "REPLACE-CSID lab" : "NEXT-CSID"})`,
      packetAfter: pkt ? packetText(pkt.daHextets, pkt.srh?.segmentsLeft, pkt.hopLimit) : undefined,
      packetAfterFrames: framesForPacket(pkt, flavor),
      lookupType: replace ? "Construct DA + SRH (REPLACE-CSID)" : "Construct DA + SRH",
      lookupResult: pkt ? `DA = ${describeDa(pkt.daHextets, flavor)}; ${pkt.srh ? `SRH Segments Left=${pkt.srh.segmentsLeft}, Last Entry=${pkt.srh.lastEntry}` : "no SRH"}` : "—",
      mutations: imposes && pkt ? [{ type: "ENCAPSULATE", detail: `Imposed outer IPv6 DA = first container${pkt.srh ? ` + SRH carrying ${pkt.srh.segmentList.length} Segment List entries` : ""}` }] : undefined,
      reason: pkt?.srh ? "Segment List storage is reversed (Segment List[0] = final entry); CSIDs inside each container stay in forward order." : "One container fits entirely in the IPv6 DA — there is nothing for an SRH to carry.",
    };
  }
  // forward
  return {
    ...common,
    egressInterfaceId: ifaceId(HEADEND, firstHop, state.links),
    packetBefore: pkt ? packetText(pkt.daHextets, pkt.srh?.segmentsLeft, pkt.hopLimit) : undefined,
    packetAfter: pkt ? packetText(pkt.daHextets, pkt.srh?.segmentsLeft, pkt.hopLimit) : undefined,
    lookupType: "IPv6 FIB (longest-prefix match)",
    lookupKey: pkt ? `DA ${fmtIpv6(pkt.daHextets)}` : undefined,
    lookupResult: firstHop ? `next hop ${firstHop} (toward ${firstOwner}, owner of the active CSID)` : "—",
    nextHopId: firstHop,
    nextHopLabel: firstHop,
    reason: "R1 does not own the active CSID — ordinary IPv6 forwarding toward the Locator-Block/Locator-Node. No CSID processing happens here.",
  };
}

// ---------------------------------------------------------------------------
// R2..R8 — endpoint (instruction owner) or transit, per walk
// ---------------------------------------------------------------------------

function traceForRouter(router: RouterId, state: Srv6CsidState, stepId: string): DeviceProcessingTrace {
  const replace = isReplacePhase(stepId);
  const walk = walkFor(state, stepId);
  const idle: DeviceProcessingTrace = { deviceId: router, stages: endpointStages(undefined, false, replace), completedStageIds: [] };
  if (!walk) return idle;

  const path = physicalPathFor(state, stepId);
  const pos = path.lastIndexOf(router);
  const ingressPeer = pos > 0 ? path[pos - 1] : undefined;
  const hopIdx = walk.hops.map((h) => h.router).lastIndexOf(router);
  const hop = hopIdx === -1 ? undefined : walk.hops[hopIdx];

  if (!hop) {
    if (pos <= 0) return idle;
    if (router === walk.at && walk.packet) {
      // Packet has physically arrived; its processing is a later step — show arrival only.
      const pkt = walk.packet;
      return { ...idle, completedStageIds: ["ingress"], ingressInterfaceId: ifaceId(router, ingressPeer, state.links), packetBefore: packetText(pkt.daHextets, pkt.srh?.segmentsLeft, pkt.hopLimit), reason: `Packet arrived from ${ingressPeer}; local processing has not happened yet.` };
    }
    // Ordinary IPv6 transit — on the physical path, owns no active instruction.
    const egressPeer = path[pos + 1];
    const prevOwnerHop = [...walk.hops].reverse().find((h) => path.lastIndexOf(h.router) < pos);
    const da = prevOwnerHop?.daAfter ?? walk.packet?.daHextets;
    const owner = da && prevOwnerHop ? ownerOfCsid(activeCsidOf(da, lblHextets(prevOwnerHop))) : undefined;
    const sl = prevOwnerHop?.segmentsLeftAfter;
    const hl = prevOwnerHop?.hopLimitAfter ?? walk.packet?.hopLimit ?? 0;
    return {
      deviceId: router,
      stages: TRANSIT_STAGES,
      completedStageIds: TRANSIT_STAGES.map((s) => s.id),
      ingressInterfaceId: ifaceId(router, ingressPeer, state.links),
      egressInterfaceId: ifaceId(router, egressPeer, state.links),
      packetBefore: da ? packetText(da, sl, hl) : undefined,
      packetAfter: da ? `${packetText(da, sl, hl)} (unchanged)` : undefined,
      lookupType: "IPv6 FIB (longest-prefix match)",
      lookupKey: da ? `DA ${fmtIpv6(da)}` : undefined,
      lookupResult: egressPeer ? `not a local SID on ${router} — next hop ${egressPeer}` : "—",
      nextHopId: egressPeer,
      nextHopLabel: egressPeer,
      mutations: [],
      reason: `Transit router: the active SID belongs to ${owner ?? "another router"}. No CSID shift, no Index change, no Segments Left change — ordinary IPv6 forwarding only.`,
    };
  }

  const isDt4Step = stepId === "replace-dt4-execute" && router === "R8";
  const stages = endpointStages(hop, isDt4Step, hop.flavor === "REPLACE_CSID");
  const primary = PRIMARY_TRANSITION[stepId];
  const activeStageId = primary && primary.router === router && stages.some((s) => s.id === primary.stage) ? primary.stage : undefined;
  const completedStageIds = activeStageId ? before(stages, activeStageId) : stages.map((s) => s.id);

  // Egress: the physical next router already taken, else the scenario's own
  // forwarding decision (End.X adjacency or IGP shortest path toward the new
  // active CSID's owner). FINAL has no egress.
  let egressPeer: RouterId | undefined;
  if (hop.action !== "FINAL") {
    egressPeer = path[pos + 1];
    if (!egressPeer) {
      const nextOwner = ownerOfCsid(activeCsidOf(hop.daAfter, lblHextets(hop)));
      egressPeer = hop.forwardVia ?? (nextOwner ? computeIgpShortestPath(state.links, router, nextOwner)?.path[1] : undefined);
    }
  }
  const lastEntry = walk.packet?.srh?.lastEntry;
  const lbl = lblHextets(hop);

  if (isDt4Step) {
    const dt4 = executeEndDt4Decap(CSID_CUST_HOST);
    return {
      deviceId: router,
      stages,
      activeStageId,
      completedStageIds,
      ingressInterfaceId: ifaceId(router, ingressPeer, state.links),
      packetBefore: packetText(hop.daAfter, hop.segmentsLeftAfter, hop.hopLimitAfter),
      packetAfter: dt4.delivered ? `Inner IPv4 → ${CSID_CUST_HOST} via ${dt4.matchedRoute}` : "Not delivered",
      packetBeforeFrames: hopFrames(hop, "after", lastEntry),
      lookupType: "End.DT4 — IPv4 VRF lookup",
      lookupKey: CSID_CUST_HOST,
      lookupResult: dt4.delivered ? `delivered via ${dt4.matchedRoute}` : "no matching VRF route",
      mutations: [{ type: "DECAPSULATE", detail: "Outer IPv6 removed (End.DT4 decapsulation); inner IPv4 looked up in the VRF" }],
      reason: "The reconstructed SID matches R8's own local End.DT4 SID. The compression flavor changed how the list advanced — never End.DT4's service meaning.",
    };
  }

  return {
    deviceId: router,
    stages,
    activeStageId,
    completedStageIds,
    ingressInterfaceId: ifaceId(router, ingressPeer, state.links),
    egressInterfaceId: ifaceId(router, egressPeer, state.links),
    packetBefore: packetText(hop.daBefore, hop.segmentsLeftBefore, hop.hopLimitBefore),
    packetAfter: packetText(hop.daAfter, hop.segmentsLeftAfter, hop.hopLimitAfter),
    packetBeforeFrames: hopFrames(hop, "before", lastEntry),
    packetAfterFrames: hopFrames(hop, "after", lastEntry),
    forwardingAction: hop.action,
    lookupType: "Local SID Table (exact match)",
    lookupKey: hop.flavor === "NEXT_CSID" ? `active CSID ${csidHexText(activeCsidOf(hop.daBefore, lbl))} in DA ${fmtIpv6(hop.daBefore)}` : `SID ${describeDa(hop.daBefore, hop.flavor)}`,
    lookupResult: `MATCH on ${router} — ${behaviorText(hop)} → ${hop.action}${hop.action === "FINAL" ? " (sequence complete)" : ""}`,
    nextHopId: egressPeer,
    nextHopLabel: egressPeer ? (hop.forwardVia ? `${egressPeer} (End.X adjacency)` : egressPeer) : undefined,
    mutations: hopMutations(hop),
    reason: hop.forwardVia ? `${hop.reason} Forwarded via the End.X adjacency to ${hop.forwardVia}, not the IPv6 FIB.` : hop.reason,
  };
}

export function traceFor(router: RouterId, state: Srv6CsidState, currentStepId: string): DeviceProcessingTrace {
  return router === HEADEND ? traceForHeadend(state, currentStepId) : traceForRouter(router, state, currentStepId);
}

export function pipelineTitleFor(trace: DeviceProcessingTrace | undefined, stepId: string): string {
  if (!trace) return "Conceptual Forwarding Pipeline";
  if (trace.deviceId === HEADEND) return "Conceptual CSID Headend Pipeline";
  if (trace.stages === TRANSIT_STAGES) return "Conceptual IPv6 Transit Pipeline";
  return isReplacePhase(stepId) ? "Conceptual REPLACE-CSID Endpoint Pipeline" : "Conceptual NEXT-CSID Endpoint Pipeline";
}

// ---------------------------------------------------------------------------
// Device Explorer tables — read-only views of scenario data.
// ---------------------------------------------------------------------------

type Row = { label: string; value: string };

/** Locator routes (LOC = Locator-Block + Locator-Node = 64 bits here) with next hops from the scenario's own IGP shortest path. */
export function ipv6RoutesFor(router: RouterId, state: Srv6CsidState): Row[] {
  return ALL_ROUTERS.filter((r) => r !== HEADEND).map((r) => {
    const prefix = `${fmtIpv6([...LOCATOR_BLOCK_HEXTETS, NEXT_CSID_VALUE[r], 0, 0, 0, 0])}/64`;
    if (r === router) return { label: prefix, value: "local (own locator)" };
    const sp = computeIgpShortestPath(state.links, router, r);
    return { label: prefix, value: sp ? `via ${sp.path[1]} (cost ${sp.cost})` : "unreachable" };
  });
}

/** Every local behavior this router owns in any of the scenario's programs (BASE / End.X / REPLACE labs). */
export function localSidsFor(router: RouterId): Row[] {
  if (router === HEADEND) return [];
  const rows: Row[] = [{ label: `${BEHAVIOR_LABEL.END} (ordinary)`, value: ordinarySidText(router) }];
  const seen = new Set<string>();
  const add = (program: typeof BASE_PROGRAM, flavor: string) => {
    for (const s of program.filter((p) => p.owner === router)) {
      const key = `${s.behavior}+${flavor}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ label: `${BEHAVIOR_LABEL[s.behavior]} + ${flavor}`, value: `CSID ${csidHexText(NEXT_CSID_VALUE[router])} under ${LOCATOR_BLOCK_TEXT}${s.adjacency ? ` · adjacency → ${s.adjacency}` : ""}` });
    }
  };
  add(BASE_PROGRAM, "NEXT-CSID");
  add(ENDX_PROGRAM, "NEXT-CSID");
  add(REPLACE_PROGRAM, "REPLACE-CSID");
  return rows;
}

/** Container state of the CURRENT phase packet's DA — read straight from its hextets. */
export function containerStateRows(state: Srv6CsidState, stepId: string): Row[] {
  const pkt = phasePacketFor(state, stepId);
  if (!pkt) return [];
  const replace = isReplacePhase(stepId);
  const lbl = (replace ? REPLACE_CSID_LAYOUT : NEXT_CSID_LAYOUT).lblBits / 16;
  const rows: Row[] = [{ label: "IPv6 DA", value: fmtIpv6(pkt.daHextets) }, { label: "Locator-Block", value: LOCATOR_BLOCK_TEXT }];
  if (replace) {
    rows.push({ label: "Active CSID (Locator-Node / Function)", value: `${csidHexText(pkt.daHextets[lbl])} / ${csidHexText(pkt.daHextets[lbl + 1])}` }, { label: "Index", value: String(pkt.daHextets[7]) });
  } else {
    const slots = pkt.daHextets.slice(lbl);
    const queued = slots.slice(1).filter((v) => v !== 0);
    rows.push(
      { label: "Active CSID", value: `${csidHexText(slots[0])} (${ownerOfCsid(slots[0]) ?? "?"})` },
      { label: "Queued CSIDs (Argument)", value: queued.length ? queued.map((v) => `${csidHexText(v)} (${ownerOfCsid(v) ?? "?"})`).join(", ") : "none — Argument is zero" },
      { label: "Zero-padding slots", value: String(slots.slice(1).filter((v) => v === 0).length) },
    );
  }
  rows.push(pkt.srh ? { label: "SRH", value: `Segments Left=${pkt.srh.segmentsLeft}, Last Entry=${pkt.srh.lastEntry}` } : { label: "SRH", value: "absent — single container in the DA" });
  return rows;
}

export function packetFramesFor(state: Srv6CsidState, stepId: string, activeStageId: string | undefined): PacketStackFrame[] | undefined {
  if (!activeStageId) return undefined;
  return framesForPacket(phasePacketFor(state, stepId), isReplacePhase(stepId) ? "REPLACE_CSID" : "NEXT_CSID");
}

// ---------------------------------------------------------------------------
// Interfaces / link detail
// ---------------------------------------------------------------------------

export function interfacesFor(router: RouterId, state: Srv6CsidState, currentStepId: string): DeviceInterfaceData[] {
  const trace = traceFor(router, state, currentStepId);
  const processing = trace.activeStageId !== undefined;
  const structure = liveStructures(state)[router];
  const validation = validateSidStructureForCompression(structure);
  return state.links
    .filter((l) => l.a === router || l.b === router)
    .map((l) => {
      const neighbor = l.a === router ? l.b : l.a;
      const id = `${router}:${neighbor}`;
      return {
        id,
        name: `to ${neighbor}`,
        status: "up",
        neighborId: neighbor,
        neighborLabel: neighbor,
        linkType: l.metric > 10 ? `IPv6 core — alternate (metric ${l.metric})` : `IPv6 core (metric ${l.metric})`,
        protocols: ["IPv6 IGP", "SRv6"],
        role: processing && id === trace.ingressInterfaceId ? "ingress" : processing && id === trace.egressInterfaceId ? "egress" : "idle",
        extra: [
          { label: "Locator-Node", value: router === HEADEND ? "— (headend)" : csidHexText(NEXT_CSID_VALUE[router]) },
          { label: "Structure", value: structure ? `LBL=${structure.lbl} LNL=${structure.lnl} FL=${structure.fl} AL=${structure.al}` : "unknown" },
          { label: "Compressibility", value: validation.validity },
        ],
      };
    });
}

export function linkDetailFor(linkId: string, state: Srv6CsidState, stepId: string, packet: PacketVisual | undefined): LinkDetail | undefined {
  const link = state.links.find((l) => l.id === linkId);
  if (!link) return undefined;
  const iface = (router: RouterId, neighbor: RouterId): DeviceInterfaceData => ({ id: `${router}:${neighbor}`, name: `to ${neighbor}`, status: "up", neighborId: neighbor, neighborLabel: neighbor, role: "idle" });
  const animated = animatedHopFor(packet, state, stepId);
  const carriesNow = animated && animated.fromId !== animated.toId && linkBetween(state.links, animated.fromId, animated.toId)?.id === link.id;
  const carriedEarlier = physicalLinkIdsFor(state, stepId).has(link.id);
  const pkt = phasePacketFor(state, stepId);
  return {
    aLabel: link.a,
    bLabel: link.b,
    aInterface: iface(link.a, link.b),
    bInterface: iface(link.b, link.a),
    status: "up",
    protocols: [
      { label: "IGP metric", value: String(link.metric) },
      { label: "Role", value: link.metric > 10 ? "Alternate physical link — higher metric than the chain it shortcuts" : "Chain link" },
    ],
    currentTraffic: carriesNow && pkt ? `Compressed SRv6 packet, DA=${fmtIpv6(pkt.daHextets)}` : carriedEarlier ? "Carried this lab's packet earlier in the walk" : undefined,
  };
}
