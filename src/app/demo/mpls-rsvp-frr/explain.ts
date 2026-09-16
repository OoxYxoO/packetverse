import type { NodeExplanation } from "@/components/network3d/types";
import { STEP_IDX, fmtLabel, rsvpFrrSteps, type Bypass, type RouterId, type RsvpFrrState } from "@/lib/sim-engine/scenarios/rsvpFrr";
import { forwardingEntryFor } from "./deviceTrace";

/**
 * All RSVP-TE-FRR-specific reasoning for the 3D node inspector lives
 * here, not inside network3d/*. Every sentence is derived from live
 * RsvpFrrState at the CURRENT step — node explanations must never leak
 * a future failure or repair before it has actually happened (brief
 * §58), so every branch below is gated on the live step index / live
 * state, never a hardcoded "this device will later..." statement.
 */

const stepIndex = (id: string) => rsvpFrrSteps.findIndex((s) => s.id === id);

const DEVICE_TYPE: Record<RouterId, string> = {
  R1: "RSVP-TE Headend",
  R3: "Core Router",
  R4: "Core Router (Bypass Transit)",
  R5: "Core Router",
  R6: "RSVP-TE Tailend",
  R7: "Core Router",
};
const ROLE: Record<RouterId, string> = {
  R1: "Headend",
  R3: "PLR (for R3-R5 / R5)",
  R4: "Bypass Transit",
  R5: "Transit / Link-Protection Merge Point",
  R6: "Tailend",
  R7: "Transit / Node-Protection Merge Point",
};

function activeBypassFor(state: RsvpFrrState): Bypass | undefined {
  if (state.activeBypassId === state.linkBypass?.id) return state.linkBypass;
  if (state.activeBypassId === state.nodeBypass?.id) return state.nodeBypass;
  return undefined;
}

export function explainNode(state: RsvpFrrState, nodeId: RouterId, currentStepId: string): NodeExplanation {
  const i = stepIndex(currentStepId);
  const active = activeBypassFor(state);
  const inJourney = state.journey.find((h) => h.router === nodeId);

  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId], role: ROLE[nodeId], currentAction: "" };

  const bypassTable = (b: Bypass | undefined) =>
    b
      ? {
          title: `${b.protectionType === "LINK" ? "Link" : "Node"}-Protecting Bypass`,
          rows: [
            { label: "Protected Resource", value: b.protectedResource },
            { label: "PLR", value: b.plr },
            { label: "Merge Point", value: b.mergePoint },
            { label: "Bypass Path", value: b.path.join(" → ") },
            { label: "State", value: b.lifecycle },
            { label: "Active", value: state.activeBypassId === b.id ? "YES" : "NO" },
          ],
        }
      : undefined;

  if (nodeId === "R1") {
    let currentAction = "Idle.";
    if (i < STEP_IDX.predictR3R5Fail) currentAction = "RSVP-PRIMARY already UP — 500 Mbps, R1 → R3 → R5 → R7 → R6.";
    else if (inJourney) currentAction = `${inJourney.lookup} → ${inJourney.action}.`;
    if (i >= STEP_IDX.reoptimizationIntro && state.reoptimized) currentAction += ` R1 has since computed a new end-to-end path: ${state.reoptimized.path.join(" → ")}.`;
    return {
      ...base,
      controlPlaneRole: "Headend of RSVP-PRIMARY. Never learns about a link/transit failure before the PLR has already repaired it locally.",
      dataPlaneRole: "Pushes the transport label using installed RSVP-TE forwarding state — completely unaware of any FRR activity elsewhere on the path.",
      currentAction,
      packetBefore: inJourney?.input,
      packetAfter: inJourney?.output,
    };
  }

  if (nodeId === "R6") {
    return {
      ...base,
      controlPlaneRole: "Tailend of RSVP-PRIMARY.",
      dataPlaneRole: "Receives the exposed IP packet after PHP and delivers it — identical regardless of whether the path used the primary route or a local detour.",
      currentAction: inJourney ? `${inJourney.lookup} → ${inJourney.action}.` : "Idle — no packet delivered yet at this point in the timeline.",
      packetBefore: inJourney?.input,
      packetAfter: inJourney?.output,
    };
  }

  if (nodeId === "R3") {
    let currentAction = "Idle.";
    if (i < STEP_IDX.frrIntro) currentAction = "Ordinary transit router on RSVP-PRIMARY — no protection concept introduced yet.";
    else if (i < STEP_IDX.establishLinkBypass && !state.linkBypass) currentAction = "Identified as the PLR for the R3-R5 protected link — no bypass requested yet.";
    else if (state.linkBypass && state.linkBypass.lifecycle !== "READY" && state.linkBypass.lifecycle !== "LOCAL_REPAIR_ACTIVE" && !active) currentAction = `Bypass ${state.linkBypass.lifecycle === "PROTECTION_SIGNALING" ? "being signaled" : state.linkBypass.lifecycle}.`;
    else if (state.failure && !active) currentAction = "Detects the protected resource is unavailable — checking for a matching, READY backup.";
    else if (active) currentAction = inJourney ? `${inJourney.lookup} → ${inJourney.action}.` : `Local repair ACTIVE via ${active.path.join(" → ")} — protected-LSP context preserved underneath the bypass label.`;
    else if (state.linkBypass?.lifecycle === "READY" || state.nodeBypass?.lifecycle === "READY") currentAction = "Protection READY — primary traffic still forwards normally; the bypass is on standby, not carrying anything.";
    return {
      ...base,
      controlPlaneRole: "PLR for the R3-R5 link and for router R5 itself. Detects failure locally and activates prepared protection — never waits for R1.",
      dataPlaneRole: active ? "Prepares the protected-LSP forwarding context (the label the Merge Point already expects) and pushes the bypass's own outer label on top." : "Ordinary primary-LSP transit forwarding while the protected resource is healthy.",
      currentAction,
      packetBefore: inJourney?.input,
      packetAfter: inJourney?.output,
      tables: [bypassTable(state.linkBypass), bypassTable(state.nodeBypass)].filter((t): t is NonNullable<typeof t> => !!t),
    };
  }

  if (nodeId === "R4") {
    let currentAction = "Not a normal primary-LSP hop — only carries traffic when a bypass through it is active.";
    if (active?.path.includes("R4")) currentAction = inJourney ? `${inJourney.lookup} → ${inJourney.action}.` : `Bypass transit for the ${active.protectionType === "LINK" ? "link" : "node"}-protecting bypass — acts only on the outer bypass label.`;
    else if (state.linkBypass || state.nodeBypass) currentAction = "Bypass transit, currently idle — the bypass(es) through it are READY but not carrying protected traffic right now.";
    return {
      ...base,
      controlPlaneRole: "Transit hop for the bypass tunnel(s) only — never a primary-LSP hop, never holds primary RSVP-TE session state.",
      dataPlaneRole: "Reads only the outer bypass label. The inner protected-LSP label rides underneath, completely untouched.",
      currentAction,
      packetBefore: inJourney?.input,
      packetAfter: inJourney?.output,
      note: "R4 never inspects the inner protected-LSP label for its own forwarding decision.",
    };
  }

  if (nodeId === "R5") {
    const isMp = active?.mergePoint === "R5";
    const failed = state.failedNode === "R5";
    let currentAction = failed ? "This router has failed completely — it cannot act as a Merge Point for anything." : "Ordinary transit router on RSVP-PRIMARY.";
    if (!failed && isMp) currentAction = inJourney ? `${inJourney.lookup} → ${inJourney.action}.` : "Merge Point for the link-protecting bypass — resumes normal protected-LSP forwarding once the bypass terminates here.";
    else if (!failed && inJourney) currentAction = `${inJourney.lookup} → ${inJourney.action}.`;
    return {
      ...base,
      controlPlaneRole: "Merge Point for R3-R5 link protection (not for node protection — a failed R5 cannot merge anything).",
      dataPlaneRole: failed ? "Failed — no forwarding occurs here." : "Normal protected-LSP transit; when acting as Merge Point, receives exactly its usual incoming label and never re-runs CSPF.",
      currentAction,
      packetBefore: inJourney?.input,
      packetAfter: inJourney?.output,
      note: failed ? "A link-protecting bypass whose Merge Point is this router cannot help once the router itself has failed." : undefined,
    };
  }

  // R7
  const isMpNode = active?.mergePoint === "R7";
  let currentAction = "Ordinary transit router on RSVP-PRIMARY.";
  if (isMpNode) currentAction = inJourney ? `${inJourney.lookup} → ${inJourney.action}.` : "Merge Point for the node-protecting bypass — resumes normal protected-LSP forwarding, skipping the failed R5 entirely.";
  else if (inJourney) currentAction = `${inJourney.lookup} → ${inJourney.action}.`;
  return {
    ...base,
    controlPlaneRole: "Merge Point for R5 node protection.",
    dataPlaneRole: "Normal protected-LSP transit toward R6; when acting as Merge Point, receives exactly its usual incoming label regardless of whether it arrived via R5 or via the bypass.",
    currentAction,
    packetBefore: inJourney?.input,
    packetAfter: inJourney?.output,
  };
}

export function forwardingLabelText(state: RsvpFrrState, router: RouterId): string {
  const entry = forwardingEntryFor(router, state);
  if (!entry) return "—";
  const incoming = entry.incomingLabel === "UNLABELED" ? "unlabeled" : fmtLabel(entry.incomingLabel);
  const outgoing = entry.outgoingLabels?.map((l) => fmtLabel(l)).join(" / ") ?? entry.action;
  return `${incoming} → ${entry.action} → ${outgoing}`;
}
