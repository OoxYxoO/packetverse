import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketMutation, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { fmtIpv6 } from "@/lib/sim-engine/scenarios/srv6Foundations";
import {
  CE2_IPV4_PREFIX,
  CE3_IPV4_PREFIX,
  CUST_A_EXPORT_RT,
  CUST_A_IMPORT_RT,
  CUST_A_RD,
  GRAPH_EDGES,
  INFRA_LOOPBACK,
  LOCATOR_PREFIX,
  PE1_DT4_SID,
  PE2_DT4_SID,
  PE2_DT6_SID,
  srv6L3vpnSteps,
  type L3vpnPacketState,
  type RouterId,
  type Srv6L3vpnState,
} from "@/lib/sim-engine/scenarios/srv6L3vpn";

/**
 * Scene Adapter for SRv6 L3VPN's device-interior 3D view (ARCHITECTURE.md
 * §4). Every stage list/checkpoint/interface/link-detail value below is
 * derived FROM Srv6L3vpnState — no VRF/BGP/SRv6 decision is made here.
 *
 * Level 3 enrichment (ARCHITECTURE.md §18) layers `lookupType`/`lookupKey`/
 * `lookupResult`/`nextHopId`/`nextHopLabel`/`reason`/`packetBeforeFrames`/
 * `packetAfterFrames`/`mutations` onto the existing per-stepId branches —
 * every value is a RESHAPE of a fact the scenario file already computed
 * (an `ImportProgress`'s own `rtImport`/`bgpNextHop`/`serviceSidResolution`
 * reasons, a `JourneyHop`'s own `input`/`lookup`/`action`/`output` text),
 * never a new VRF/RT/SID decision. New control-plane branches were added
 * for the route-build/import steps (`route-create` … `route-installed`,
 * `second-prefix-same-sid`, `ipv6-vpn-intro`, `pe1-advertises-ce1`), which
 * previously fell through to an idle base trace with nothing inspectable —
 * mirrors MPLS L3VPN's PE1_CONTROL_STAGES/PE2_CONTROL_STAGES split.
 */

const stepIndex = (id: string) => srv6L3vpnSteps.findIndex((s) => s.id === id);

// ---------------------------------------------------------------------------
// Stage lists
// ---------------------------------------------------------------------------

const PE1_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress Interface" },
  { id: "identify-vrf", label: "Identify VRF (CUST-A)" },
  { id: "vrf-lookup", label: "VRF Route Lookup" },
  { id: "select-sid", label: "Select Service SID" },
  { id: "encapsulate", label: "SRv6 Encapsulation" },
  { id: "egress", label: "Egress Interface" },
];
const P_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "ipv6-fib", label: "IPv6 FIB Lookup" },
  { id: "forward", label: "Forward Toward Locator" },
  { id: "egress", label: "Egress" },
];
const PE2_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "local-sid-match", label: "Local SID Match" },
  { id: "service-decap", label: "Decapsulate (End.DT4/DT6)" },
  { id: "egress-vrf-lookup", label: "Egress VRF Lookup" },
  { id: "deliver", label: "Deliver to CE" },
  { id: "egress", label: "Egress" },
];
/** Either PE's control-plane side, ORIGIN role — building and advertising its own local route. */
const ADVERTISE_STAGES: ProcessingStage[] = [
  { id: "vrf-route", label: "VRF Local Route" },
  { id: "apply-rd", label: "Apply RD" },
  { id: "attach-rt", label: "Attach Export RT + Next Hop" },
  { id: "attach-sid", label: "Attach Service SID" },
  { id: "mpbgp-advertise", label: "MP-BGP Advertise" },
];
/** Either PE's control-plane side, RECEIVER role — importing a route MP-BGP delivers. */
const IMPORT_STAGES: ProcessingStage[] = [
  { id: "mpbgp-receive", label: "MP-BGP Receive" },
  { id: "rt-import", label: "RT Import Check" },
  { id: "nexthop-resolve", label: "BGP Next-Hop Resolve" },
  { id: "sid-resolve", label: "Service SID Resolve" },
  { id: "install", label: "VRF Install" },
];

function allIds(stages: ProcessingStage[]) {
  return stages.map((s) => s.id);
}

// ---------------------------------------------------------------------------
// Packet-stack framing — a deterministic reshape of `L3vpnPacketState`,
// never a new fact. Shared by the trace branches below and by
// `packetFramesFor` (the live in-flight packet stack).
// ---------------------------------------------------------------------------

function framesFor(pkt: L3vpnPacketState | undefined, topChanged: boolean): PacketStackFrame[] | undefined {
  if (!pkt) return undefined;
  const frames: PacketStackFrame[] = [{ id: "outer", text: `Outer IPv6 (DA=${fmtIpv6(pkt.outer.daHextets)})`, tone: "transport", justChanged: topChanged }];
  if (pkt.outer.srh) frames.push({ id: "srh", text: `SRH (SL=${pkt.outer.srh.segmentsLeft})`, tone: "vpn" });
  if (pkt.inner) frames.push({ id: "inner", text: pkt.inner.kind === "IPV4" ? "Inner IPv4" : pkt.inner.kind === "IPV6" ? "Inner IPv6" : "Inner Ethernet", tone: "ip" });
  return frames;
}
function preEncapFrame(): PacketStackFrame[] {
  return [{ id: "plain", text: "Plain customer packet (no outer header yet)", tone: "generic" }];
}
function deliveredFrame(text: string): PacketStackFrame[] {
  return [{ id: "delivered", text, tone: "ip", justChanged: true }];
}

function mutationsFor(type: "ENCAPSULATE" | "DECAPSULATE", detail: string): PacketMutation[] {
  return [{ type, detail }];
}

// ---------------------------------------------------------------------------
// PE1
// ---------------------------------------------------------------------------

function traceForPe1(state: Srv6L3vpnState, currentStepId: string): DeviceProcessingTrace {
  const i = stepIndex(currentStepId);

  // --- Control plane: PE1 as ORIGIN (reverse direction, §G) ---
  if (currentStepId === "pe1-advertises-ce1") {
    return {
      deviceId: "PE1",
      stages: ADVERTISE_STAGES,
      activeStageId: "mpbgp-advertise",
      completedStageIds: allIds(ADVERTISE_STAGES).slice(0, -1),
      lookupType: "MP-BGP VPN Advertise",
      lookupKey: `${CUST_A_RD.PE1}:${"10.10.1.0/24"}`,
      lookupResult: `Advertised to PE2 — RT ${CUST_A_EXPORT_RT}, next hop ${INFRA_LOOPBACK.PE1}, Service SID ${PE1_DT4_SID.sidText}`,
      reason: "PE1 advertises its OWN local route with its OWN Service SID — never reusing PE2's.",
      nextHopId: "PE2",
      nextHopLabel: "PE2",
    };
  }

  // --- Control plane: PE1 as RECEIVER ---
  if (currentStepId === "mpbgp-advertise-ipv4") {
    return {
      deviceId: "PE1",
      stages: IMPORT_STAGES,
      activeStageId: "mpbgp-receive",
      completedStageIds: [],
      lookupType: "MP-BGP VPN Receive",
      lookupKey: `${CUST_A_RD.PE2}:${CE2_IPV4_PREFIX}`,
      lookupResult: "Received — RD, RT, next hop, and SRv6 L3 Service TLV all in one UPDATE; not yet imported.",
      reason: "PE1 receives the complete VPN route from PE2, including the Prefix-SID Attribute's SRv6 L3 Service TLV.",
    };
  }
  if (currentStepId === "predict-rt-import") {
    return { deviceId: "PE1", stages: IMPORT_STAGES, activeStageId: "mpbgp-receive", completedStageIds: [], lookupType: "MP-BGP VPN Receive", lookupResult: "Received — RT import check pending" };
  }
  if (currentStepId === "rt-import-check") {
    const entry = findEntry(state, "PE1", CE2_IPV4_PREFIX);
    return {
      deviceId: "PE1",
      stages: IMPORT_STAGES,
      activeStageId: "rt-import",
      completedStageIds: ["mpbgp-receive"],
      lookupType: "RT Import Check",
      lookupKey: `Route RT ${entry?.route.rt ?? CUST_A_EXPORT_RT} vs. CUST-A import RT ${CUST_A_IMPORT_RT}`,
      lookupResult: entry?.rtImport?.passed ? "Match" : "No match",
      reason: entry?.rtImport?.reason ?? "RT is the only thing import policy checks — RD only guarantees uniqueness.",
    };
  }
  if (currentStepId === "bgp-nexthop-resolve") {
    const entry = findEntry(state, "PE1", CE2_IPV4_PREFIX);
    return {
      deviceId: "PE1",
      stages: IMPORT_STAGES,
      activeStageId: "nexthop-resolve",
      completedStageIds: ["mpbgp-receive", "rt-import"],
      lookupType: "BGP Next-Hop Resolve",
      lookupKey: INFRA_LOOPBACK.PE2,
      lookupResult: entry?.bgpNextHop?.reason ?? `${INFRA_LOOPBACK.PE2} reachable via the IPv6 underlay IGP`,
      reason: "Ordinary infrastructure routing — unrelated to PE2's SRv6 locator.",
    };
  }
  if (currentStepId === "service-sid-resolve") {
    const entry = findEntry(state, "PE1", CE2_IPV4_PREFIX);
    return {
      deviceId: "PE1",
      stages: IMPORT_STAGES,
      activeStageId: "sid-resolve",
      completedStageIds: ["mpbgp-receive", "rt-import", "nexthop-resolve"],
      lookupType: "Service SID Resolve",
      lookupKey: `${PE2_DT4_SID.sidText} (locator ${LOCATOR_PREFIX.PE2})`,
      lookupResult: entry?.serviceSidResolution?.reason ?? `${LOCATOR_PREFIX.PE2} present in the IPv6 FIB — resolves`,
      reason: "A SEPARATE question from BGP next-hop reachability — checked against the IPv6 FIB for PE2's locator, not PE2's infra loopback.",
    };
  }
  if (currentStepId === "route-installed") {
    return {
      deviceId: "PE1",
      stages: IMPORT_STAGES,
      activeStageId: "install",
      completedStageIds: ["mpbgp-receive", "rt-import", "nexthop-resolve", "sid-resolve"],
      lookupType: "VRF Install",
      lookupKey: CE2_IPV4_PREFIX,
      lookupResult: `Installed into CUST-A via ${PE2_DT4_SID.sidText}`,
      reason: "All three checks (RT import, BGP next hop, Service SID resolution) passed.",
    };
  }
  if (currentStepId === "second-prefix-same-sid") {
    return {
      deviceId: "PE1",
      stages: IMPORT_STAGES,
      activeStageId: "install",
      completedStageIds: allIds(IMPORT_STAGES).slice(0, -1),
      lookupType: "VRF Install",
      lookupKey: CE3_IPV4_PREFIX,
      lookupResult: `Installed into CUST-A via the SAME ${PE2_DT4_SID.sidText}`,
      reason: "Same Service SID as CE2's route — per-VRF sharing, not a new SID allocation.",
    };
  }
  if (currentStepId === "ipv6-vpn-intro") {
    return {
      deviceId: "PE1",
      stages: IMPORT_STAGES,
      activeStageId: "install",
      completedStageIds: allIds(IMPORT_STAGES).slice(0, -1),
      lookupType: "VRF Install",
      lookupKey: "2001:db8:ca:20::/64, 2001:db8:ca:30::/64",
      lookupResult: `Both installed into CUST-A via ${PE2_DT6_SID.sidText} (End.DT6)`,
      reason: "Same per-VRF sharing idea, now for the IPv6 table.",
    };
  }
  if (currentStepId === "fault-injected") {
    return {
      deviceId: "PE1",
      stages: IMPORT_STAGES,
      activeStageId: "sid-resolve",
      completedStageIds: ["mpbgp-receive", "rt-import", "nexthop-resolve"],
      lookupType: "Service SID Resolve",
      lookupKey: `${PE2_DT4_SID.sidText} (locator ${LOCATOR_PREFIX.PE2})`,
      lookupResult: `${LOCATOR_PREFIX.PE2} NOT in the IPv6 FIB — unresolvable`,
      reason: "PE2's locator was withdrawn from the IPv6 IGP — PE2's BGP next hop (infra loopback) is still fine, so RT import and next-hop resolution both still pass.",
    };
  }
  if (currentStepId === "repair-challenge" && state.repairAttempt?.correct) {
    return {
      deviceId: "PE1",
      stages: IMPORT_STAGES,
      activeStageId: "install",
      completedStageIds: allIds(IMPORT_STAGES).slice(0, -1),
      lookupType: "Service SID Resolve",
      lookupKey: `${PE2_DT4_SID.sidText} (locator ${LOCATOR_PREFIX.PE2})`,
      lookupResult: `${LOCATOR_PREFIX.PE2} restored — resolves again`,
      reason: "PE2's locator route restored — all CUST-A routes originated by PE2 are re-installed.",
    };
  }
  if (i >= stepIndex("mpbgp-advertise-ipv4") && i < stepIndex("send-ce1-ce2")) {
    return { deviceId: "PE1", stages: IMPORT_STAGES, activeStageId: "install", completedStageIds: allIds(IMPORT_STAGES), lookupResult: "CUST-A routes installed" };
  }

  // --- Data plane: forwarding pipeline ---
  const base: DeviceProcessingTrace = { deviceId: "PE1", ingressInterfaceId: "PE1-ce1", egressInterfaceId: "PE1-p1", stages: PE1_STAGES, completedStageIds: [] };
  if (!PE1_DATA_STEPS.has(currentStepId) && i < stepIndex("send-ce1-ce2")) return base;

  if (currentStepId === "send-ce1-ce2") {
    return { ...base, activeStageId: "ingress", packetBefore: "Plain IPv4 packet arrives from CE1", packetBeforeFrames: preEncapFrame(), lookupType: "Ingress", reason: "CE1 sends a plain customer IPv4 packet — no VRF context selected yet." };
  }
  if (currentStepId === "pe1-vrf-lookup") {
    const entry = findEntry(state, "PE1", CE2_IPV4_PREFIX);
    return {
      ...base,
      activeStageId: "vrf-lookup",
      completedStageIds: ["ingress", "identify-vrf"],
      packetBefore: "IPv4 packet (VRF CUST-A match)",
      packetBeforeFrames: preEncapFrame(),
      lookupType: "VRF Route Lookup",
      lookupKey: `${CE2_IPV4_PREFIX} in VRF CUST-A`,
      lookupResult: `Matched — Service SID ${entry?.route.prefixSid?.l3Service.serviceSid.sidText ?? PE2_DT4_SID.sidText}`,
      nextHopId: "PE2",
      nextHopLabel: "PE2",
      reason: "VRF CUST-A matched — not the provider's global table.",
    };
  }
  if (currentStepId === "pe1-encapsulate" || currentStepId === "predict-no-srh") {
    const after: L3vpnPacketState = { outer: { srcText: "", daHextets: PE2_DT4_SID.sidHextets } };
    return {
      ...base,
      activeStageId: "encapsulate",
      completedStageIds: ["ingress", "identify-vrf", "vrf-lookup", "select-sid"],
      packetBefore: "IPv4 packet",
      packetAfter: `[Outer IPv6 DA=${PE2_DT4_SID.sidText}][IPv4]`,
      packetBeforeFrames: preEncapFrame(),
      packetAfterFrames: framesFor(after, true),
      lookupType: "SRv6 Encapsulation (H.Encaps)",
      lookupResult: `Outer IPv6 DA = ${PE2_DT4_SID.sidText}, no SRH`,
      nextHopId: "P1",
      nextHopLabel: "P1",
      mutations: mutationsFor("ENCAPSULATE", `Outer IPv6 header added — DA = ${PE2_DT4_SID.sidText} (PE2's End.DT4 Service SID), no SRH`),
      reason: "A single Service SID needs no segment list — the DA alone carries it.",
    };
  }
  if (currentStepId === "send-ce1-ce3" || currentStepId === "send-ce2-ce1" || currentStepId === "send-ce1-ce2-ipv6") {
    const sid = currentStepId === "send-ce1-ce2-ipv6" ? PE2_DT6_SID : PE2_DT4_SID;
    const after: L3vpnPacketState = { outer: { srcText: "", daHextets: sid.sidHextets } };
    return {
      ...base,
      completedStageIds: allIds(PE1_STAGES),
      packetBefore: "IPv4/IPv6 packet",
      packetAfter: `Outer IPv6 [Service SID][inner]`,
      packetBeforeFrames: preEncapFrame(),
      packetAfterFrames: framesFor(after, false),
      lookupType: "SRv6 Encapsulation (H.Encaps)",
      lookupResult: `Outer IPv6 DA = ${sid.sidText}`,
      nextHopId: "P1",
      nextHopLabel: "P1",
    };
  }
  if (currentStepId === "verify-dataplane") {
    const after: L3vpnPacketState = { outer: { srcText: "", daHextets: PE2_DT4_SID.sidHextets } };
    return {
      ...base,
      completedStageIds: allIds(PE1_STAGES),
      packetBefore: "IPv4 packet (verification)",
      packetAfter: `[Outer IPv6 DA=${PE2_DT4_SID.sidText}][IPv4]`,
      packetBeforeFrames: preEncapFrame(),
      packetAfterFrames: framesFor(after, false),
      lookupType: "SRv6 Encapsulation (H.Encaps)",
      lookupResult: `Outer IPv6 DA = ${PE2_DT4_SID.sidText}`,
      nextHopId: "P1",
      nextHopLabel: "P1",
      reason: "Verification packet — proves the repair restored the data plane, not just the control plane.",
    };
  }
  return { ...base, completedStageIds: allIds(PE1_STAGES) };
}

// ---------------------------------------------------------------------------
// P1 / P2 — plain IPv6 transit, zero customer-VRF state
// ---------------------------------------------------------------------------

function traceForP(router: "P1" | "P2", state: Srv6L3vpnState, currentStepId: string): DeviceProcessingTrace {
  const i = stepIndex(currentStepId);
  const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: router === "P1" ? "P1-pe1" : "P2-p1", egressInterfaceId: router === "P1" ? "P1-p2" : "P2-pe2", stages: P_STAGES, completedStageIds: [] };
  const transitStepsForRouter = router === "P1" ? new Set(["pe1-encapsulate", "predict-no-srh", "p1-transit", "predict-p-routers", "send-ce1-ce2-ipv6"]) : new Set(["p1-transit", "predict-p-routers", "p2-transit", "send-ce1-ce2-ipv6"]);
  if (!transitStepsForRouter.has(currentStepId) && i < stepIndex("pe1-encapsulate")) return base;
  if (transitStepsForRouter.has(currentStepId)) {
    const da = currentStepId === "send-ce1-ce2-ipv6" ? PE2_DT6_SID : PE2_DT4_SID;
    const nextHop = router === "P1" ? "P2" : "PE2";
    return {
      ...base,
      activeStageId: "forward",
      completedStageIds: ["ingress", "ipv6-fib"],
      packetBefore: "Outer IPv6 [Service SID][inner]",
      packetAfter: "Outer IPv6 [Service SID][inner] — unchanged",
      packetBeforeFrames: framesFor({ outer: { srcText: "", daHextets: da.sidHextets } }, false),
      packetAfterFrames: framesFor({ outer: { srcText: "", daHextets: da.sidHextets } }, false),
      lookupType: "IPv6 FIB",
      lookupKey: da.sidText,
      lookupResult: `Falls inside ${da.owner}'s locator ${LOCATOR_PREFIX[da.owner] ?? "—"} → forward toward ${nextHop}`,
      nextHopId: nextHop,
      nextHopLabel: nextHop,
      reason: `${router} forwards on the outer IPv6 destination only — zero knowledge of CUST-A, RD, RT, or End.DT4/DT6.`,
    };
  }
  return { ...base, completedStageIds: allIds(P_STAGES) };
}

// ---------------------------------------------------------------------------
// PE2
// ---------------------------------------------------------------------------

function traceForPe2(state: Srv6L3vpnState, currentStepId: string): DeviceProcessingTrace {
  const i = stepIndex(currentStepId);

  // --- Control plane: PE2 as ORIGIN ---
  if (currentStepId === "service-sid-intro" || currentStepId === "per-vrf-shared-sid" || currentStepId === "bgp-prefix-sid-intro" || currentStepId === "srv6-l3-service-tlv") {
    return { deviceId: "PE2", stages: ADVERTISE_STAGES, activeStageId: "attach-sid", completedStageIds: ["vrf-route", "apply-rd", "attach-rt"], lookupType: "Allocate Service SID", lookupResult: `${PE2_DT4_SID.sidText} (End.DT4) · ${PE2_DT6_SID.sidText} (End.DT6)`, reason: "Per-VRF Service SIDs — shared by any prefix inside CUST-A, never per-prefix." };
  }
  if (currentStepId === "route-create") {
    return { deviceId: "PE2", stages: ADVERTISE_STAGES, activeStageId: "vrf-route", completedStageIds: [], lookupType: "VRF Local Route", lookupKey: CE2_IPV4_PREFIX, lookupResult: "Route shell created", reason: "PE2 starts from its own local route, behind CE2." };
  }
  if (currentStepId === "route-add-rd") {
    return { deviceId: "PE2", stages: ADVERTISE_STAGES, activeStageId: "apply-rd", completedStageIds: ["vrf-route"], lookupType: "Apply RD", lookupResult: `${CUST_A_RD.PE2}:${CE2_IPV4_PREFIX}`, reason: "RD only makes the route unique in MP-BGP — never controls import." };
  }
  if (currentStepId === "route-attach-rt") {
    return { deviceId: "PE2", stages: ADVERTISE_STAGES, activeStageId: "attach-rt", completedStageIds: ["vrf-route", "apply-rd"], lookupType: "Attach Export RT + Next Hop", lookupResult: `RT ${CUST_A_EXPORT_RT}, next hop ${INFRA_LOOPBACK.PE2}`, reason: "PE2 sets itself as BGP next hop — ordinary route reachability, separate from the Service SID." };
  }
  if (currentStepId === "route-attach-servicesid") {
    return { deviceId: "PE2", stages: ADVERTISE_STAGES, activeStageId: "attach-sid", completedStageIds: ["vrf-route", "apply-rd", "attach-rt"], lookupType: "Attach Service SID", lookupResult: `${PE2_DT4_SID.sidText} (End.DT4) via SRv6 L3 Service TLV`, reason: "Carried in the BGP Prefix-SID Attribute — never an ordinary VPN label field." };
  }
  if (currentStepId === "mpbgp-advertise-ipv4") {
    return { deviceId: "PE2", stages: ADVERTISE_STAGES, activeStageId: "mpbgp-advertise", completedStageIds: allIds(ADVERTISE_STAGES).slice(0, -1), lookupType: "MP-BGP VPN Advertise", lookupKey: `${CUST_A_RD.PE2}:${CE2_IPV4_PREFIX}`, lookupResult: "Advertised to PE1", reason: "RD, RT, next hop, and Service SID all travel in one MP-BGP UPDATE.", nextHopId: "PE1", nextHopLabel: "PE1" };
  }
  if (currentStepId === "second-prefix-same-sid") {
    return { deviceId: "PE2", stages: ADVERTISE_STAGES, activeStageId: "mpbgp-advertise", completedStageIds: allIds(ADVERTISE_STAGES).slice(0, -1), lookupType: "MP-BGP VPN Advertise", lookupKey: `${CUST_A_RD.PE2}:${CE3_IPV4_PREFIX}`, lookupResult: `Advertised to PE1 — SAME Service SID ${PE2_DT4_SID.sidText}`, reason: "Same RD scheme, same RT, same Service SID as CE2's route — only the prefix differs.", nextHopId: "PE1", nextHopLabel: "PE1" };
  }
  if (currentStepId === "ipv6-vpn-intro") {
    return { deviceId: "PE2", stages: ADVERTISE_STAGES, activeStageId: "mpbgp-advertise", completedStageIds: allIds(ADVERTISE_STAGES).slice(0, -1), lookupType: "MP-BGP VPN Advertise", lookupKey: "2001:db8:ca:20::/64, 2001:db8:ca:30::/64", lookupResult: `Advertised to PE1 via ${PE2_DT6_SID.sidText} (End.DT6)`, reason: "Dual-stack CUST-A — same per-VRF sharing idea, now for IPv6.", nextHopId: "PE1", nextHopLabel: "PE1" };
  }

  // --- Control plane: PE2 as RECEIVER (reverse direction) ---
  if (currentStepId === "pe1-advertises-ce1") {
    return { deviceId: "PE2", stages: IMPORT_STAGES, activeStageId: "install", completedStageIds: allIds(IMPORT_STAGES).slice(0, -1), lookupType: "VRF Install", lookupKey: CE1_IPV4_PREFIX, lookupResult: `Installed into CUST-A via PE1's OWN Service SID ${PE1_DT4_SID.sidText}`, reason: "PE2 never reuses its own Service SID for a route it imports — each PE's Service SID is only ever locally significant to that PE." };
  }

  if (currentStepId === "fault-injected" || currentStepId === "incident" || currentStepId === "repair-challenge") {
    const withdrawn = state.locatorWithdrawn.PE2;
    return {
      deviceId: "PE2",
      stages: PE2_STAGES,
      completedStageIds: [],
      lookupType: "SRv6 Locator",
      lookupKey: LOCATOR_PREFIX.PE2,
      lookupResult: withdrawn ? "WITHDRAWN from the IPv6 IGP" : "Advertised — resolvable again",
      reason: withdrawn ? "PE2 itself and its BGP infra loopback stay fully healthy — only the locator route is gone." : "Locator restored — remote PEs can resolve PE2's Service SIDs again.",
    };
  }

  if (i >= stepIndex("route-create") && i < stepIndex("send-ce1-ce2")) {
    return { deviceId: "PE2", stages: ADVERTISE_STAGES, activeStageId: "mpbgp-advertise", completedStageIds: allIds(ADVERTISE_STAGES), lookupResult: "CUST-A routes advertised" };
  }

  // --- Data plane: forwarding pipeline ---
  const base: DeviceProcessingTrace = { deviceId: "PE2", ingressInterfaceId: "PE2-p2", egressInterfaceId: "PE2-ce2", stages: PE2_STAGES, completedStageIds: [] };
  if (!PE2_DATA_STEPS.has(currentStepId) && i < stepIndex("pe2-local-sid-match")) return base;

  if (currentStepId === "pe2-local-sid-match") {
    return {
      ...base,
      activeStageId: "local-sid-match",
      completedStageIds: ["ingress"],
      packetBefore: `Outer IPv6 DA=${PE2_DT4_SID.sidText}`,
      packetBeforeFrames: framesFor({ outer: { srcText: "", daHextets: PE2_DT4_SID.sidHextets } }, false),
      lookupType: "Local SID Table",
      lookupKey: PE2_DT4_SID.sidText,
      lookupResult: "Match — behavior End.DT4, table CUST-A",
      reason: "PE2's own local SID table owns this SID — an exact match, not a prefix lookup.",
    };
  }
  if (currentStepId === "pe2-dt4-execute" || currentStepId === "pe2-dt4-execute-ce3") {
    const ceHost = currentStepId === "pe2-dt4-execute" ? "10.20.1.10" : "10.20.2.10";
    const ceTarget: RouterId = currentStepId === "pe2-dt4-execute" ? "CE2" : "CE3";
    const before: L3vpnPacketState = { outer: { srcText: "", daHextets: PE2_DT4_SID.sidHextets } };
    return {
      ...base,
      activeStageId: "service-decap",
      egressInterfaceId: ceTarget === "CE2" ? "PE2-ce2" : "PE2-ce3",
      completedStageIds: ["ingress", "local-sid-match"],
      packetBefore: "Outer IPv6 [Service SID][IPv4]",
      packetAfter: `IPv4 packet → ${ceTarget}`,
      packetBeforeFrames: framesFor(before, false),
      packetAfterFrames: deliveredFrame(`Inner IPv4 → ${ceTarget}`),
      lookupType: "End.DT4 — CUST-A IPv4 Lookup",
      lookupKey: ceHost,
      lookupResult: `Matched — delivered to ${ceTarget}`,
      nextHopId: ceTarget,
      nextHopLabel: ceTarget,
      mutations: mutationsFor("DECAPSULATE", `Outer IPv6 header + Service SID removed — inner IPv4 exposed, VRF CUST-A lookup selects ${ceTarget}`),
      reason: "The SAME Service SID for both CE2 and CE3 — the table lookup after decapsulation is what actually selects the final CE.",
    };
  }
  if (currentStepId === "send-ce2-ce1") {
    return {
      ...base,
      activeStageId: "egress-vrf-lookup",
      egressInterfaceId: "PE2-p2",
      completedStageIds: ["ingress"],
      packetBefore: `IPv4 packet (VRF CUST-A match)`,
      packetBeforeFrames: preEncapFrame(),
      lookupType: "VRF Route Lookup",
      lookupKey: `${CE1_IPV4_PREFIX} in VRF CUST-A`,
      lookupResult: `Matched — PE1's OWN Service SID ${PE1_DT4_SID.sidText}`,
      nextHopId: "P2",
      nextHopLabel: "P2",
      mutations: mutationsFor("ENCAPSULATE", `Outer IPv6 header added — DA = ${PE1_DT4_SID.sidText} (PE1's End.DT4 Service SID)`),
      reason: "PE2's ingress lookup this time selects PE1's Service SID — never its own.",
    };
  }
  if (currentStepId === "pe2-dt6-execute") {
    const before: L3vpnPacketState = { outer: { srcText: "", daHextets: PE2_DT6_SID.sidHextets } };
    return {
      ...base,
      activeStageId: "service-decap",
      completedStageIds: ["ingress", "local-sid-match"],
      packetBefore: "Outer IPv6 [Service SID][inner IPv6]",
      packetAfter: "IPv6 packet → CE2",
      packetBeforeFrames: framesFor(before, false),
      packetAfterFrames: deliveredFrame("Inner IPv6 → CE2"),
      lookupType: "End.DT6 — CUST-A IPv6 Lookup",
      lookupKey: "2001:db8:ca:20::a",
      lookupResult: "Matched — delivered to CE2",
      nextHopId: "CE2",
      nextHopLabel: "CE2",
      mutations: mutationsFor("DECAPSULATE", "Outer IPv6 header + Service SID removed — inner IPv6 exposed, VRF CUST-A IPv6 table lookup selects CE2"),
      reason: "Same per-VRF End.DT6 dispatch, now on CUST-A's IPv6 table.",
    };
  }
  if (currentStepId === "verify-dataplane") {
    const before: L3vpnPacketState = { outer: { srcText: "", daHextets: PE2_DT4_SID.sidHextets } };
    return {
      ...base,
      egressInterfaceId: "PE2-ce3",
      completedStageIds: allIds(PE2_STAGES),
      packetBefore: "Outer IPv6 [Service SID][IPv4]",
      packetAfter: "IPv4 packet → CE3",
      packetBeforeFrames: framesFor(before, false),
      packetAfterFrames: deliveredFrame("Inner IPv4 → CE3"),
      lookupType: "End.DT4 — CUST-A IPv4 Lookup",
      lookupResult: "Matched — delivered to CE3",
      nextHopId: "CE3",
      nextHopLabel: "CE3",
      reason: "Confirms the repair restored the full data plane, not just the control plane.",
    };
  }
  return { ...base, completedStageIds: allIds(PE2_STAGES) };
}

const CE1_IPV4_PREFIX = "10.10.1.0/24";
const PE1_DATA_STEPS = new Set(["send-ce1-ce2", "pe1-vrf-lookup", "pe1-encapsulate", "predict-no-srh", "send-ce1-ce3", "send-ce2-ce1", "send-ce1-ce2-ipv6", "verify-dataplane"]);
const PE2_DATA_STEPS = new Set(["pe2-local-sid-match", "pe2-dt4-execute", "pe2-dt4-execute-ce3", "send-ce2-ce1", "pe2-dt6-execute", "verify-dataplane"]);

const findEntry = (state: Srv6L3vpnState, receiver: RouterId, prefix: string) => (state.installedAt[receiver] ?? []).find((p) => p.route.prefix === prefix);

export function traceFor(router: RouterId, state: Srv6L3vpnState, currentStepId: string): DeviceProcessingTrace | undefined {
  if (router === "PE1") return traceForPe1(state, currentStepId);
  if (router === "P1" || router === "P2") return traceForP(router, state, currentStepId);
  if (router === "PE2") return traceForPe2(state, currentStepId);
  return undefined;
}

export function packetFramesFor(state: Srv6L3vpnState, activeStageId: string | undefined): PacketStackFrame[] | undefined {
  const topChanged = activeStageId === "encapsulate" || activeStageId === "service-decap" || activeStageId === "egress-vrf-lookup";
  return framesFor(state.packet, topChanged);
}

// ---------------------------------------------------------------------------
// HopTimeline support — which device is the primary inspection subject of
// a no-packet control-plane/narrative step, and the shared sender-priority
// rule for steps that DO carry a packet (mirrors MPLS L3VPN/SRv6 Policy).
// ---------------------------------------------------------------------------

export const PRIMARY_TRANSITION_ROUTER: Partial<Record<string, RouterId>> = {
  "service-sid-intro": "PE2",
  "per-vrf-shared-sid": "PE2",
  "bgp-prefix-sid-intro": "PE2",
  "srv6-l3-service-tlv": "PE2",
  "route-create": "PE2",
  "route-add-rd": "PE2",
  "route-attach-rt": "PE2",
  "route-attach-servicesid": "PE2",
  "predict-rt-import": "PE1",
  "rt-import-check": "PE1",
  "bgp-nexthop-resolve": "PE1",
  "service-sid-resolve": "PE1",
  "route-installed": "PE1",
  "second-prefix-same-sid": "PE2",
  "pe1-vrf-lookup": "PE1",
  "p1-transit": "P1",
  "p2-transit": "P2",
  "pe2-local-sid-match": "PE2",
  "pe1-advertises-ce1": "PE1",
  "ipv6-vpn-intro": "PE2",
  "fault-injected": "PE1",
  "repair-challenge": "PE1",
};

/**
 * Packet steps whose visual starts at a customer endpoint (CE1 → PE1). CE1 is
 * not a modeled processing device (`traceFor` has no CE trace); the ingress
 * lookup/encapsulation for these moments is modeled on PE1 (`traceForPe1`).
 */
const CE_INGRESS_INSPECTION_DEVICE: Partial<Record<string, RouterId>> = {
  "send-ce1-ce2": "PE1",
  "send-ce1-ce3": "PE1",
  "verify-dataplane": "PE1",
};

/** Sender-priority (`packet.from ?? packet.to`) — a packet step is inspected on the router that PERFORMED the lookup/encapsulation/decapsulation (the packet's sender for that hop), matching MPLS L3VPN's own rule. The exception is a CE-originated ingress visual, whose sender is a customer endpoint; those steps are inspected on the ingress PE instead (`CE_INGRESS_INSPECTION_DEVICE`). */
export function deviceForStep(stepId: string, packet: PacketVisual | undefined): RouterId | undefined {
  const ingressPe = CE_INGRESS_INSPECTION_DEVICE[stepId];
  if (ingressPe) return ingressPe;
  if (packet) return (packet.from ?? packet.to) as RouterId;
  return PRIMARY_TRANSITION_ROUTER[stepId];
}

// ---------------------------------------------------------------------------
// Physical interfaces
// ---------------------------------------------------------------------------

interface IfaceDef {
  id: string;
  name: string;
  ip: string;
  neighborId: RouterId;
  neighborLabel: string;
  linkType: string;
  mtu: number;
  protocols: string[];
}
const INTERFACES: Record<RouterId, IfaceDef[]> = {
  CE1: [{ id: "CE1-pe1", name: "ge-0/0/0", ip: "10.10.1.1/24", neighborId: "PE1", neighborLabel: "PE1", linkType: "Access", mtu: 1500, protocols: ["Static"] }],
  PE1: [
    { id: "PE1-ce1", name: "ge-0/0/0", ip: "10.10.1.254/24", neighborId: "CE1", neighborLabel: "CE1", linkType: "Access (VRF CUST-A)", mtu: 1500, protocols: ["Static"] },
    { id: "PE1-p1", name: "xe-0/1/0", ip: "2001:db8:ffff:12::1/126", neighborId: "P1", neighborLabel: "P1", linkType: "Core (IPv6/SRv6)", mtu: 9192, protocols: ["IPv6 IGP", "SRv6"] },
  ],
  P1: [
    { id: "P1-pe1", name: "xe-0/0/0", ip: "2001:db8:ffff:12::2/126", neighborId: "PE1", neighborLabel: "PE1", linkType: "Core (IPv6/SRv6)", mtu: 9192, protocols: ["IPv6 IGP"] },
    { id: "P1-p2", name: "xe-0/1/0", ip: "2001:db8:ffff:23::1/126", neighborId: "P2", neighborLabel: "P2", linkType: "Core (IPv6/SRv6)", mtu: 9192, protocols: ["IPv6 IGP"] },
  ],
  P2: [
    { id: "P2-p1", name: "xe-0/0/0", ip: "2001:db8:ffff:23::2/126", neighborId: "P1", neighborLabel: "P1", linkType: "Core (IPv6/SRv6)", mtu: 9192, protocols: ["IPv6 IGP"] },
    { id: "P2-pe2", name: "xe-0/1/0", ip: "2001:db8:ffff:24::1/126", neighborId: "PE2", neighborLabel: "PE2", linkType: "Core (IPv6/SRv6)", mtu: 9192, protocols: ["IPv6 IGP"] },
  ],
  PE2: [
    { id: "PE2-p2", name: "xe-0/0/0", ip: "2001:db8:ffff:24::2/126", neighborId: "P2", neighborLabel: "P2", linkType: "Core (IPv6/SRv6)", mtu: 9192, protocols: ["IPv6 IGP", "SRv6"] },
    { id: "PE2-ce2", name: "ge-0/1/0", ip: "10.20.1.254/24", neighborId: "CE2", neighborLabel: "CE2", linkType: "Access (VRF CUST-A)", mtu: 1500, protocols: ["Static"] },
    { id: "PE2-ce3", name: "ge-0/2/0", ip: "10.20.2.254/24", neighborId: "CE3", neighborLabel: "CE3", linkType: "Access (VRF CUST-A)", mtu: 1500, protocols: ["Static"] },
  ],
  CE2: [{ id: "CE2-pe2", name: "ge-0/0/0", ip: "10.20.1.10/24", neighborId: "PE2", neighborLabel: "PE2", linkType: "Access", mtu: 1500, protocols: ["Static"] }],
  CE3: [{ id: "CE3-pe2", name: "ge-0/0/0", ip: "10.20.2.10/24", neighborId: "PE2", neighborLabel: "PE2", linkType: "Access", mtu: 1500, protocols: ["Static"] }],
};

export function interfacesFor(router: RouterId, state: Srv6L3vpnState, currentStepId: string): DeviceInterfaceData[] {
  const trace = traceFor(router, state, currentStepId);
  const processing = trace?.activeStageId !== undefined;
  return INTERFACES[router].map((def) => ({
    id: def.id,
    name: def.name,
    status: "up",
    ip: def.ip,
    neighborId: def.neighborId,
    neighborLabel: def.neighborLabel,
    linkType: def.linkType,
    mtu: def.mtu,
    protocols: def.protocols,
    packetCount: trace && (trace.completedStageIds.length > 0 || processing) ? 1 : 0,
    role: processing && def.id === trace?.ingressInterfaceId ? "ingress" : processing && def.id === trace?.egressInterfaceId ? "egress" : "idle",
  }));
}

export function linkDetailFor(linkId: string, state: Srv6L3vpnState): LinkDetail | undefined {
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!edge) return undefined;
  const a = edge.a as RouterId;
  const b = edge.b as RouterId;
  const aIface = INTERFACES[a].find((f) => f.neighborId === b);
  const bIface = INTERFACES[b].find((f) => f.neighborId === a);
  if (!aIface || !bIface) return undefined;
  const isCore = aIface.linkType.startsWith("Core");
  const currentlyCarrying = state.packetAt && [a, b].includes(state.packetAt) && state.packet ? `[Service SID ${fmtIpv6(state.packet.outer.daHextets)}]${state.packet.inner ? "[inner]" : ""}` : undefined;
  return {
    aLabel: a,
    bLabel: b,
    aInterface: { id: aIface.id, name: aIface.name, status: "up", ip: aIface.ip, neighborId: b, neighborLabel: b, linkType: aIface.linkType, mtu: aIface.mtu, protocols: aIface.protocols, role: "idle" },
    bInterface: { id: bIface.id, name: bIface.name, status: "up", ip: bIface.ip, neighborId: a, neighborLabel: a, linkType: bIface.linkType, mtu: bIface.mtu, protocols: bIface.protocols, role: "idle" },
    status: "up",
    mtu: aIface.mtu,
    protocols: isCore ? [{ label: "IGP", value: "IPv6 (conceptual)" }, { label: "SRv6", value: "Enabled" }] : [{ label: "VRF", value: "CUST-A" }],
    currentTraffic: currentlyCarrying,
  };
}
