import type { NodeExplanation } from "@/components/network3d/types";
import { STEP_IDX, buildEro, buildRro, buildRsvpForwardingState, fmtLabel, rsvpTeSteps, type RouterId, type RsvpTeState } from "@/lib/sim-engine/scenarios/rsvpTe";

/**
 * All RSVP-TE-specific reasoning for the 3D node inspector lives
 * here, not inside any network3d/ component (brief §50: "No CSPF,
 * RSVP, bandwidth, or label-allocation logic belongs in network3d/*").
 * Every sentence below is derived from live RsvpTeState — nothing is
 * hand-written per lesson step, so it stays correct automatically
 * through Previous/Restart/replay.
 *
 * Critical accuracy note (brief §27/§49): during an active PATH/RESV
 * exchange or data forwarding, this only ever describes OBSERVABLE
 * state (session/label/reservation values) — it never fabricates
 * root-cause claims the model doesn't represent.
 */

const stepIndex = (id: string) => rsvpTeSteps.findIndex((s) => s.id === id);

const DEVICE_TYPE: Record<RouterId, string> = {
  R1: "RSVP-TE Ingress (Headend)",
  R2: "Core Router",
  R3: "Core Router",
  R4: "Core Router",
  R5: "Core Router",
  R6: "RSVP-TE Egress (Tailend)",
};
const ROLE: Record<RouterId, string> = {
  R1: "Ingress / Headend",
  R2: "Transit (Top Path)",
  R3: "Transit (Bottom Path)",
  R4: "Transit (Top Path)",
  R5: "Transit (Bottom Path)",
  R6: "Egress / Tailend",
};

export function explainNode(state: RsvpTeState, nodeId: RouterId, currentStepId: string): NodeExplanation {
  const i = stepIndex(currentStepId);
  const { lsp } = state;
  const onPath = lsp.path?.includes(nodeId) ?? false;
  const hop = lsp.hops[nodeId];
  const fwd = buildRsvpForwardingState(lsp);
  const entry = fwd[nodeId];

  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId], role: ROLE[nodeId], currentAction: "" };

  const rsvpTable = onPath
    ? {
        title: `${nodeId} — RSVP Session`,
        rows: [
          { label: "Tunnel", value: `${lsp.ingress} → ${lsp.egress}` },
          { label: "PATH state", value: hop?.pathSent ? "Sent downstream" : hop?.pathReceived ? "Received" : "Not yet reached" },
          { label: "RESV state", value: hop?.resvSent ? "Sent upstream" : hop?.resvReceived ? "Received" : "Not yet reached" },
          { label: "Requested Bandwidth", value: `${lsp.requestedBandwidthMbps} Mbps` },
          { label: "Reservation", value: lsp.state === "UP" ? `${lsp.reservedBandwidthMbps} Mbps` : "Not yet installed" },
          { label: "Label Advertised Upstream", value: hop?.label !== undefined ? fmtLabel(hop.label) : "—" },
        ],
      }
    : undefined;

  if (nodeId === "R1") {
    let currentAction = "Idle — no tunnel signaled yet.";
    if (i < STEP_IDX.cspfAnalysisFull) currentAction = "Idle — the 500 Mbps requirement exists, but CSPF hasn't run yet.";
    else if (i < STEP_IDX.eroIntro) currentAction = lsp.cspf?.path ? `CSPF selected ${lsp.cspf.path.join(" → ")} (TE metric ${lsp.cspf.teMetricTotal}).` : "CSPF is evaluating the topology against the current bandwidth constraint.";
    else if (i < STEP_IDX.pathHop1) currentAction = `ERO built: ${lsp.path ? buildEro(lsp.path).join(" → ") : "—"}. About to originate PATH.`;
    else if (i < STEP_IDX.resvHop1) currentAction = hop?.pathSent ? "PATH sent downstream — waiting for RESV to return." : "About to originate PATH toward the first ERO hop.";
    else if (i < STEP_IDX.lspUp) currentAction = hop?.resvReceived ? `RESV received — label to push: ${entry?.outgoingLabel !== undefined ? fmtLabel(entry.outgoingLabel) : "—"}.` : "Waiting for RESV to return from the egress.";
    else if (lsp.state === "UP") currentAction = state.packet && state.packetAt !== "R1" ? `LSP UP — pushed ${entry?.outgoingLabel !== undefined ? fmtLabel(entry.outgoingLabel) : ""} onto the current packet.` : `LSP UP — ${lsp.reservedBandwidthMbps} Mbps reserved via ${lsp.path?.join(" → ")}.`;
    return {
      ...base,
      controlPlaneRole: "Runs CSPF against the Traffic Engineering Database, builds the ERO, and originates PATH. Has no previous RSVP hop — it's the headend.",
      dataPlaneRole: "Classifies traffic into the tunnel and pushes the transport label using RSVP-installed forwarding state — never re-runs CSPF per packet.",
      currentAction,
      packetBefore: entry ? "IP packet (unlabeled)" : undefined,
      packetAfter: entry?.outgoingLabel !== undefined ? `PUSH ${fmtLabel(entry.outgoingLabel)}` : undefined,
      tables: [rsvpTable, lsp.cspf ? { title: "CSPF Result", rows: [{ label: "Constraint", value: `${lsp.cspf.constraint.requiredBandwidthMbps} Mbps${lsp.cspf.constraint.affinityInclude ? `, affinity ${lsp.cspf.constraint.affinityInclude}` : ""}` }, { label: "Path", value: lsp.cspf.path?.join(" → ") ?? "NO VALID PATH" }] } : undefined].filter((t): t is NonNullable<typeof t> => !!t),
    };
  }

  if (nodeId === "R6") {
    let currentAction = "Idle — not yet on the signaled path.";
    if (onPath && hop?.pathReceived && !hop?.resvSent) currentAction = "PATH received — evaluating the requested bandwidth and generating a reservation response (implicit-null, PHP).";
    else if (onPath && hop?.resvSent) currentAction = lsp.state === "UP" ? `LSP UP — this is the egress; delivers plain IP after upstream PHP.` : "RESV sent upstream — implicit-null advertised toward the penultimate hop.";
    return {
      ...base,
      controlPlaneRole: "Tailend of the tunnel — receives PATH, evaluates the request, and originates RESV upstream. Has no next RSVP hop.",
      dataPlaneRole: "Receives an already-exposed IP packet (the penultimate hop already popped the label via PHP) and delivers it.",
      currentAction,
      packetBefore: state.journey.some((h) => h.router === "R6") ? "IP packet (unlabeled, after PHP)" : undefined,
      packetAfter: state.journey.some((h) => h.router === "R6") ? "Delivered" : undefined,
      tables: [rsvpTable].filter((t): t is NonNullable<typeof t> => !!t),
    };
  }

  // Core transit routers R2, R3, R4, R5
  let currentAction = onPath ? "On the signaled path." : "Not part of the currently signaled LSP.";
  if (onPath) {
    if (i < STEP_IDX.pathHop1) currentAction = "Not yet reached by signaling.";
    else if (hop?.pathReceived && !hop?.pathSent) currentAction = "PATH received — inspecting the ERO, verifying this is the correct next hop, recording the previous RSVP hop.";
    else if (hop?.pathSent && !hop?.resvReceived) currentAction = "PATH forwarded downstream — waiting for RESV to return from the egress side.";
    else if (hop?.resvReceived && !hop?.resvSent) currentAction = "RESV received from downstream — allocating a label and installing forwarding state before propagating RESV upstream.";
    else if (hop?.resvSent && lsp.state !== "UP") currentAction = "RESV propagated upstream — forwarding state installed.";
    else if (lsp.state === "UP") {
      const inJourney = state.journey.find((h) => h.router === nodeId);
      currentAction = inJourney ? `Data plane: ${inJourney.lookup} → ${inJourney.action}. Result: ${inJourney.output}.` : `LSP UP — forwarding entry installed: incoming ${entry?.incomingLabel !== undefined ? fmtLabel(entry.incomingLabel as never) : "—"} → ${entry?.action}${entry?.outgoingLabel !== undefined ? ` → ${fmtLabel(entry.outgoingLabel)}` : ""}.`;
    }
  } else if (!onPath && lsp.cspf && lsp.cspf.prunedLinkIds.length > 0) {
    currentAction = "Pruned from the CSPF candidate graph for this tunnel — its adjacent link failed the bandwidth constraint.";
  }

  return {
    ...base,
    controlPlaneRole: "No VRF, no BGP — participates only in the IGP, the Traffic Engineering Database, and (when on this LSP's path) RSVP-TE signaling.",
    dataPlaneRole: "Forwards using whatever label state RSVP-TE installed — never re-evaluates CSPF itself.",
    currentAction,
    packetBefore: state.journey.find((h) => h.router === nodeId)?.input,
    packetAfter: state.journey.find((h) => h.router === nodeId)?.output,
    note: onPath && lsp.state === "UP" ? `${nodeId} forwards purely on the incoming label — it never re-runs CSPF or re-evaluates the headend's original decision.` : undefined,
    tables: onPath ? [rsvpTable].filter((t): t is NonNullable<typeof t> => !!t) : [],
  };
}

export function rroFor(state: RsvpTeState): RouterId[] {
  return buildRro(state.lsp);
}
