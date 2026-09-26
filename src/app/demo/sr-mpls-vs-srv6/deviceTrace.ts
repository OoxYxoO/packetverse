import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketMutation, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import {
  GRAPH_EDGES,
  INFRA_ADDRESS,
  PROTECTED_LINK,
  adjSidLabel,
  archLabel,
  describeMplsLabel,
  describeSrv6Sid,
  type Architecture,
  type CapstoneState,
  type HopPacket,
  type JourneyHop,
  type RouterId,
} from "@/lib/sim-engine/scenarios/srMplsVsSrv6";
import { fmtIpv6 } from "@/lib/sim-engine/scenarios/srv6Foundations";

/**
 * Scene Adapter for the SR-MPLS vs SRv6 capstone (ARCHITECTURE.md §4).
 * Every Hop Inspector / PacketDiff / pipeline value is READ from a
 * `JourneyHop` the scenario's own run() recorded (its `stepId`, physical
 * `ingressPeer`/`egressPeer`, and native `before`/`after` packet) or from
 * control-plane state the scenario computed (VPN import progress, the
 * shared TI-LFA repair) — no label, SID, next hop or repair decision is
 * made here.
 *
 * Technology isolation: `traceFor` takes the architecture explicitly and
 * only ever reads hops tagged with THAT architecture, so an SR-MPLS hop
 * can never render in an SRv6 inspector or vice versa. It is also
 * step-aware: only hops recorded BY the given step are shown — the
 * single journey array interleaves both architectures and several
 * independent packets, so "the router's last hop" would routinely be a
 * stale event from another phase. A router with nothing recorded for
 * this step gets an honest idle trace (no active stage), never a
 * borrowed one.
 */

// ---------------------------------------------------------------------------
// Stage lists — per architecture, per role. Named after what each data
// plane natively does (LFIB label operation vs. IPv6 FIB / Local SID).
// ---------------------------------------------------------------------------

const MPLS_INGRESS: ProcessingStage[] = [
  { id: "ingress", label: "Ingress (unlabeled IPv4)" },
  { id: "lookup", label: "FIB / SR Policy / VRF Decision" },
  { id: "label-push", label: "Label PUSH" },
  { id: "egress", label: "Egress" },
];
const MPLS_TRANSIT: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "lfib-lookup", label: "LFIB Lookup (top label)" },
  { id: "label-op", label: "Label Operation (SWAP / PHP POP)" },
  { id: "egress", label: "Egress" },
];
const MPLS_EGRESS_VPN: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "lfib-lookup", label: "LFIB: VPN Label → VRF Context" },
  { id: "label-pop", label: "Label POP (bottom of stack)" },
  { id: "deliver", label: "VRF CUST-A Lookup → CE" },
];
const MPLS_PLR: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "failure-check", label: "Protected Resource Down" },
  { id: "repair-push", label: "PUSH Repair Label Stack" },
  { id: "egress", label: "Egress (Repair OIF)" },
];
const MPLS_REPAIR_NODE: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "lfib-lookup", label: "LFIB Lookup: Top Label = Local Adj-SID" },
  { id: "forced-adjacency", label: "Local Adj-SID: Forced Adjacency" },
  { id: "egress", label: "Egress" },
];
const SRV6_INGRESS: ProcessingStage[] = [
  { id: "ingress", label: "Ingress (customer IPv4)" },
  { id: "lookup", label: "FIB / SR Policy / VRF Decision" },
  { id: "encaps", label: "Outer IPv6 Encapsulation" },
  { id: "egress", label: "Egress" },
];
const SRV6_TRANSIT: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "ipv6-fib", label: "Ordinary IPv6 FIB Lookup (no Local SID match)" },
  { id: "egress", label: "Egress" },
];
const SRV6_ENDPOINT: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "local-sid-match", label: "Local SID Table Match" },
  { id: "behavior", label: "Endpoint Behavior" },
  { id: "deliver", label: "Forward / Deliver" },
];
const SRV6_PLR: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "failure-check", label: "Protected Resource Down" },
  { id: "repair-encaps", label: "H.Encaps Repair SID (End.X+USD)" },
  { id: "egress", label: "Egress (Repair OIF)" },
];
const SRV6_REPAIR_NODE: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "local-sid-match", label: "Local SID Match (End.X+USD)" },
  { id: "usd-decap", label: "USD: Remove Repair Outer" },
  { id: "forced-adjacency", label: "Forced Adjacency" },
  { id: "egress", label: "Egress" },
];
const VPN_CONTROL: ProcessingStage[] = [
  { id: "received", label: "VPN Route Received (MP-BGP)" },
  { id: "rt-import", label: "RT Import Check" },
  { id: "resolution", label: "Next-Hop / Service Resolution" },
  { id: "install", label: "Install in VRF CUST-A" },
];
const TILFA_CONTROL: ProcessingStage[] = [
  { id: "post-convergence", label: "Post-Convergence SPF" },
  { id: "pq-space", label: "P-Space / Q-Space" },
  { id: "repair-select", label: "Repair Node + OIF Selection" },
  { id: "failure-detect", label: "Local Failure Detection" },
];

interface StageSpec {
  stages: ProcessingStage[];
  active: string;
}
function stageSpecFor(hop: JourneyHop): StageSpec {
  if (hop.architecture === "SR_MPLS") {
    switch (hop.action) {
      case "PUSH":
        return { stages: MPLS_INGRESS, active: "label-push" };
      case "SWAP":
      case "PHP_POP":
        return { stages: MPLS_TRANSIT, active: "label-op" };
      case "VPN_LOOKUP":
        return { stages: MPLS_EGRESS_VPN, active: "label-pop" };
      case "REPAIR_PUSH":
        return { stages: MPLS_PLR, active: "repair-push" };
      default:
        return { stages: MPLS_REPAIR_NODE, active: "forced-adjacency" };
    }
  }
  switch (hop.action) {
    case "SET_DA":
    case "H_ENCAPS":
      return { stages: SRV6_INGRESS, active: "encaps" };
    case "IPV6_FIB_FORWARD":
      return { stages: SRV6_TRANSIT, active: "ipv6-fib" };
    case "LOCAL_SID_MATCH":
    case "END_DT4_DECAP":
      return { stages: SRV6_ENDPOINT, active: "behavior" };
    case "REPAIR_ENCAPSULATE":
      return { stages: SRV6_PLR, active: "repair-encaps" };
    default:
      return { stages: SRV6_REPAIR_NODE, active: hop.action === "USD_DECAP_FORWARD" ? "usd-decap" : "local-sid-match" };
  }
}
function completedBefore(stages: ProcessingStage[], active: string): string[] {
  const i = stages.findIndex((s) => s.id === active);
  return i > 0 ? stages.slice(0, i).map((s) => s.id) : [];
}

/** Native table/decision name for this hop's action — MPLS hops name the LFIB only where the label is what's looked up; SRv6 transit hops name the ordinary IPv6 FIB, never a Local SID Table. */
function lookupTypeFor(hop: JourneyHop): string {
  if (hop.architecture === "SR_MPLS") {
    switch (hop.action) {
      case "PUSH":
        return "Ingress imposition (IPv4 → MPLS label stack)";
      case "SWAP":
      case "PHP_POP":
        return "MPLS LFIB (top label)";
      case "VPN_LOOKUP":
        return "MPLS LFIB → VPN label → VRF CUST-A";
      case "REPAIR_PUSH":
        return "TI-LFA precomputed repair (MPLS label repair list)";
      default:
        return "MPLS LFIB (top label = local Adj-SID)";
    }
  }
  switch (hop.action) {
    case "SET_DA":
    case "H_ENCAPS":
      return "Ingress encapsulation (outer IPv6)";
    case "IPV6_FIB_FORWARD":
      return "IPv6 FIB — longest-prefix match (DA is not a local SID)";
    case "LOCAL_SID_MATCH":
      return "Local SID Table";
    case "END_DT4_DECAP":
      return "Local SID Table → End.DT4 → VRF CUST-A";
    case "REPAIR_ENCAPSULATE":
      return "TI-LFA precomputed repair (H.Encaps, single SID)";
    default:
      return "Local SID Table (End.X, USD flavor)";
  }
}

// ---------------------------------------------------------------------------
// Native packet framing — a deterministic reshape of each architecture's
// OWN packet type. An MPLS packet renders as a label stack over untouched
// IPv4; an SRv6 packet as an outer IPv6 header (+ SRH only when present).
// ---------------------------------------------------------------------------

function ipv4Frame(src: string, dst: string): PacketStackFrame {
  return { id: "ipv4", text: `Customer IPv4 ${src} → ${dst}`, tone: "ip" };
}

export function framesForHopPacket(p: HopPacket | undefined): PacketStackFrame[] | undefined {
  if (!p) return undefined;
  switch (p.kind) {
    case "IPV4":
      return [ipv4Frame(p.srcIp, p.dstIp)];
    case "MPLS":
      return [
        ...p.packet.labels.map((l, i) => ({
          id: `label-${i}-${l.value}`,
          text: `Label ${l.value} · ${describeMplsLabel(l.value)} · S=${l.bottomOfStack ? 1 : 0}${i === 0 ? " (top)" : ""}`,
          tone: l.purpose === "vpn" ? ("vpn" as const) : ("transport" as const),
        })),
        ipv4Frame(p.packet.srcIp, p.packet.dstIp),
      ];
    case "SRV6": {
      const frames: PacketStackFrame[] = [{ id: `outer-${fmtIpv6(p.packet.daHextets)}`, text: `Outer IPv6 DA=${fmtIpv6(p.packet.daHextets)} · ${describeSrv6Sid(p.packet.daHextets)}`, tone: "transport" }];
      const srh = p.packet.srh;
      if (srh) {
        const list = [...srh.segmentList]
          .reverse()
          .map((s) => `[${s.index}] ${describeSrv6Sid(s.sidHextets)}`)
          .join(" ");
        frames.push({ id: `srh-sl${srh.segmentsLeft}`, text: `SRH SL=${srh.segmentsLeft} LE=${srh.lastEntry} · ${list}`, tone: "transport" });
      }
      frames.push(ipv4Frame(p.packet.innerSrcIp, p.packet.innerDstIp));
      return frames;
    }
    case "SRV6_L3VPN": {
      const frames: PacketStackFrame[] = [{ id: `vpn-outer-${fmtIpv6(p.packet.outer.daHextets)}`, text: `Outer IPv6 DA=${fmtIpv6(p.packet.outer.daHextets)} · Service SID (End.DT4)`, tone: "vpn" }];
      if (p.packet.outer.srh) frames.push({ id: "vpn-srh", text: `SRH SL=${p.packet.outer.srh.segmentsLeft}`, tone: "vpn" });
      if (p.packet.inner?.kind === "IPV4") frames.push(ipv4Frame(p.packet.inner.srcIp, p.packet.inner.dstIp));
      return frames;
    }
    case "SRV6_TILFA": {
      const frames: PacketStackFrame[] = [];
      if (p.packet.repairOuter) frames.push({ id: `repair-${fmtIpv6(p.packet.repairOuter.daHextets)}`, text: `Repair outer IPv6 DA=${fmtIpv6(p.packet.repairOuter.daHextets)} · End.X+USD repair SID`, tone: "transport" });
      if (p.packet.repairOuter?.srh) frames.push({ id: "repair-srh", text: `Repair SRH SL=${p.packet.repairOuter.srh.segmentsLeft}`, tone: "transport" });
      // The nested outer's ROLE comes from the scenario packet metadata — a generic transport outer is never called L3VPN.
      if (p.packet.vpnOuter) frames.push(p.packet.vpnOuter.role === "GLOBAL_DT4_TRANSPORT" ? { id: "transport-outer", text: `SRv6 transport outer DA=${p.packet.vpnOuter.daText} · End.DT4 (global table)`, tone: "transport" } : { id: "vpn-outer", text: `SRv6 L3VPN outer DA=${p.packet.vpnOuter.daText}`, tone: "vpn" });
      if (p.packet.inner?.kind === "IPV4") frames.push(ipv4Frame(p.packet.inner.srcIp, p.packet.inner.dstIp));
      return frames;
    }
  }
}

/** Marks after-frames that did not exist (same id + text) before this hop — a pure comparison, never a decision. */
function markChanged(before: PacketStackFrame[] | undefined, after: PacketStackFrame[] | undefined): PacketStackFrame[] | undefined {
  if (!after) return undefined;
  const seen = new Set((before ?? []).map((f) => `${f.id}|${f.text}`));
  return after.map((f) => ({ ...f, justChanged: !seen.has(`${f.id}|${f.text}`) }));
}

/** Mutations derived by diffing the two native snapshots the scenario recorded — the hop's own action only names HOW (PHP vs. ordinary pop, SWAP to the same global Node-SID value). */
function mutationsFor(hop: JourneyHop): PacketMutation[] {
  const { before, after } = hop;
  if (hop.architecture === "SR_MPLS") {
    if (before?.kind !== "MPLS" || after?.kind !== "MPLS") return [];
    const inLabels = before.packet.labels;
    const outLabels = after.packet.labels;
    if (outLabels.length > inLabels.length) {
      return outLabels.slice(0, outLabels.length - inLabels.length).map((l) => ({ type: "PUSH" as const, detail: `${l.value} ${describeMplsLabel(l.value)}` }));
    }
    if (outLabels.length < inLabels.length) {
      return inLabels.slice(0, inLabels.length - outLabels.length).map((l, i) => ({ type: "POP" as const, detail: `${l.value} ${describeMplsLabel(l.value)}${hop.action === "PHP_POP" && i === 0 ? " (PHP)" : ""}` }));
    }
    if (hop.action === "SWAP" && inLabels[0] && outLabels[0]) {
      return [{ type: "SWAP", detail: `${inLabels[0].value} → ${outLabels[0].value}${inLabels[0].value === outLabels[0].value ? " (same global Node-SID value)" : ""}` }];
    }
    return [];
  }
  if (!before) return [];
  if (before.kind === "IPV4" && (after?.kind === "SRV6" || after?.kind === "SRV6_L3VPN")) {
    const da = after.kind === "SRV6" ? after.packet.daHextets : after.packet.outer.daHextets;
    const srh = after.kind === "SRV6" ? after.packet.srh : after.packet.outer.srh;
    return [{ type: "ENCAPSULATE", detail: `outer IPv6, DA=${fmtIpv6(da)}${srh ? `, SRH SL=${srh.segmentsLeft}` : ", no SRH"}` }];
  }
  if (before.kind === "SRV6_TILFA" && after?.kind === "SRV6_TILFA") {
    if (!before.packet.repairOuter && after.packet.repairOuter) return [{ type: "ENCAPSULATE", detail: `repair outer IPv6, DA=${fmtIpv6(after.packet.repairOuter.daHextets)}, ${after.packet.repairOuter.srh ? "SRH" : "no SRH"}` }];
    if (before.packet.repairOuter && !after.packet.repairOuter) return [{ type: "DECAPSULATE", detail: "repair outer IPv6 removed (USD)" }];
  }
  if (before.kind === "SRV6_L3VPN" && after?.kind === "IPV4") return [{ type: "DECAPSULATE", detail: "outer IPv6 removed (End.DT4)" }];
  if (before.kind === "SRV6" && after?.kind === "IPV4") return [{ type: "DECAPSULATE", detail: "outer IPv6 removed (End.DT4, global IPv4 table)" }];
  if (before.kind === "SRV6_TILFA" && !before.packet.repairOuter && before.packet.vpnOuter && after?.kind === "IPV4") return [{ type: "DECAPSULATE", detail: before.packet.vpnOuter.role === "GLOBAL_DT4_TRANSPORT" ? "transport outer IPv6 removed (End.DT4, global IPv4 table)" : "L3VPN outer IPv6 removed (End.DT4)" }];
  return [];
}

function lookupKeyFor(hop: JourneyHop): string | undefined {
  const b = hop.before;
  if (!b) return hop.input;
  switch (b.kind) {
    case "IPV4":
      return `IPv4 DA ${b.dstIp}`;
    case "MPLS":
      return b.packet.labels[0] ? `top label ${b.packet.labels[0].value} · ${describeMplsLabel(b.packet.labels[0].value)}` : `IPv4 DA ${b.packet.dstIp} (unlabeled)`;
    case "SRV6":
      return `IPv6 DA ${fmtIpv6(b.packet.daHextets)}${b.packet.srh ? ` · SL=${b.packet.srh.segmentsLeft}` : ""}`;
    case "SRV6_L3VPN":
      return `IPv6 DA ${fmtIpv6(b.packet.outer.daHextets)}`;
    case "SRV6_TILFA":
      return b.packet.repairOuter ? `IPv6 DA ${fmtIpv6(b.packet.repairOuter.daHextets)}` : b.packet.vpnOuter ? `IPv6 DA ${b.packet.vpnOuter.daText}` : b.packet.inner?.kind === "IPV4" ? `IPv4 DA ${b.packet.inner.dstIp}` : hop.input;
  }
}

// ---------------------------------------------------------------------------
// Physical interfaces — the ONLY source of ingress/egress interface ids.
// A peer that has no physical interface here (e.g. a logical segment's
// owner that isn't adjacent) simply yields no interface.
// ---------------------------------------------------------------------------

interface IfaceDef {
  id: string;
  name: string;
  neighborId: RouterId;
  neighborLabel: string;
  linkType: string;
  mtu: number;
}
const CORE_ROUTERS_FOR_IFACE: Exclude<RouterId, "CE1" | "CE2">[] = ["PE1", "P1", "P3", "P4", "P2", "PE2"];
function isCore(r: RouterId | undefined): r is Exclude<RouterId, "CE1" | "CE2"> {
  return !!r && (CORE_ROUTERS_FOR_IFACE as RouterId[]).includes(r);
}
function infraIp(router: RouterId): string {
  if (!isCore(router)) return "";
  return fmtIpv6(INFRA_ADDRESS[router]);
}
const INTERFACES: Record<RouterId, IfaceDef[]> = {
  CE1: [{ id: "CE1-pe1", name: "eth0", neighborId: "PE1", neighborLabel: "PE1", linkType: "Customer access", mtu: 1500 }],
  PE1: [
    { id: "PE1-ce1", name: "ge-0/0/0", neighborId: "CE1", neighborLabel: "CE1", linkType: "Customer access", mtu: 1500 },
    { id: "PE1-p1", name: "xe-0/1/0", neighborId: "P1", neighborLabel: "P1", linkType: "Core (headend uplink)", mtu: 9192 },
  ],
  P1: [
    { id: "P1-pe1", name: "xe-0/0/0", neighborId: "PE1", neighborLabel: "PE1", linkType: "Core", mtu: 9192 },
    { id: "P1-p2", name: "xe-0/1/0", neighborId: "P2", neighborLabel: "P2", linkType: "Core (Primary, TI-LFA protected)", mtu: 9192 },
    { id: "P1-p3", name: "xe-0/2/0", neighborId: "P3", neighborLabel: "P3", linkType: "Core (Repair OIF)", mtu: 9192 },
  ],
  P3: [
    { id: "P3-p1", name: "xe-0/0/0", neighborId: "P1", neighborLabel: "P1", linkType: "Core (Repair OIF)", mtu: 9192 },
    { id: "P3-p4", name: "xe-0/1/0", neighborId: "P4", neighborLabel: "P4", linkType: "Core", mtu: 9192 },
  ],
  P4: [
    { id: "P4-p3", name: "xe-0/0/0", neighborId: "P3", neighborLabel: "P3", linkType: "Core", mtu: 9192 },
    { id: "P4-p2", name: "xe-0/1/0", neighborId: "P2", neighborLabel: "P2", linkType: "Core (Merge link — repair node)", mtu: 9192 },
    { id: "P4-pe2", name: "xe-0/2/0", neighborId: "PE2", neighborLabel: "PE2", linkType: "Core (alternate)", mtu: 9192 },
  ],
  P2: [
    { id: "P2-p1", name: "xe-0/0/0", neighborId: "P1", neighborLabel: "P1", linkType: "Core (Primary, TI-LFA protected)", mtu: 9192 },
    { id: "P2-p4", name: "xe-0/1/0", neighborId: "P4", neighborLabel: "P4", linkType: "Core (Merge link)", mtu: 9192 },
    { id: "P2-pe2", name: "xe-0/2/0", neighborId: "PE2", neighborLabel: "PE2", linkType: "Core", mtu: 9192 },
  ],
  PE2: [
    { id: "PE2-p2", name: "xe-0/0/0", neighborId: "P2", neighborLabel: "P2", linkType: "Core", mtu: 9192 },
    { id: "PE2-p4", name: "xe-0/1/0", neighborId: "P4", neighborLabel: "P4", linkType: "Core (alternate)", mtu: 9192 },
    { id: "PE2-ce2", name: "ge-0/1/0", neighborId: "CE2", neighborLabel: "CE2", linkType: "Customer access", mtu: 1500 },
  ],
  CE2: [{ id: "CE2-pe2", name: "eth0", neighborId: "PE2", neighborLabel: "PE2", linkType: "Customer access", mtu: 1500 }],
};

function ifaceId(router: RouterId, neighbor: RouterId | undefined): string | undefined {
  if (!neighbor || neighbor === router) return undefined;
  return INTERFACES[router].find((f) => f.neighborId === neighbor)?.id;
}

// ---------------------------------------------------------------------------
// Traces
// ---------------------------------------------------------------------------

function hopTrace(hop: JourneyHop): DeviceProcessingTrace {
  const { stages, active } = stageSpecFor(hop);
  const beforeFrames = framesForHopPacket(hop.before);
  const afterFrames = markChanged(beforeFrames, framesForHopPacket(hop.after));
  const egressIface = ifaceId(hop.router, hop.egressPeer);
  return {
    deviceId: hop.router,
    ingressInterfaceId: ifaceId(hop.router, hop.ingressPeer),
    egressInterfaceId: egressIface,
    stages,
    activeStageId: active,
    completedStageIds: completedBefore(stages, active),
    forwardingAction: hop.action,
    lookupType: lookupTypeFor(hop),
    lookupKey: lookupKeyFor(hop),
    lookupResult: `${hop.action}: ${hop.output}`,
    // "Next hop" is only ever a PHYSICAL neighbor with a real interface — never the owner of the next logical segment.
    nextHopId: egressIface && isCore(hop.egressPeer) ? hop.egressPeer : undefined,
    nextHopLabel: egressIface ? hop.egressPeer : undefined,
    reason: `${archLabel(hop.architecture)} — ${hop.lookup}`,
    packetBefore: hop.input,
    packetAfter: hop.output,
    packetBeforeFrames: beforeFrames,
    packetAfterFrames: afterFrames,
    mutations: mutationsFor(hop),
  };
}

function idleTrace(router: RouterId, architecture: Architecture): DeviceProcessingTrace {
  return { deviceId: router, stages: architecture === "SR_MPLS" ? MPLS_TRANSIT : SRV6_TRANSIT, completedStageIds: [] };
}

/** Control-plane (VPN import) trace at PE1 — read straight off the SR-MPLS VRF / SRv6 import-progress state the step computed. */
function vpnImportTrace(state: CapstoneState, architecture: Architecture): DeviceProcessingTrace | undefined {
  if (architecture === "SR_MPLS") {
    const route = state.mplsVpnRoute;
    if (!route) return undefined;
    const imported = !!state.mplsVrfs.PE1?.some((v) => v.routes.some((r) => r.prefix === route.prefix && r.origin === "imported"));
    return {
      deviceId: "PE1",
      stages: VPN_CONTROL,
      activeStageId: "install",
      completedStageIds: ["received", "rt-import", "resolution"],
      lookupType: "MP-BGP VPNv4 import (control plane — no packet)",
      lookupKey: `${route.prefix} · RD ${route.rd} · RT ${route.rt}`,
      lookupResult: imported ? `Imported into VRF CUST-A · VPN label ${route.vpnLabel} from ${route.originPe}` : "Not imported",
      reason: `SR-MPLS: RT ${route.rt} ${imported ? "matches" : "does not match"} PE1's CUST-A import RT; the service identifier carried with the route is an MPLS VPN label.`,
    };
  }
  const progress = state.srv6ImportProgress;
  const route = state.srv6VpnRoute;
  if (!progress || !route) return undefined;
  const failedAt = !progress.rtImport?.passed ? "rt-import" : !progress.bgpNextHop?.resolvable || !progress.serviceSidResolution?.resolvable ? "resolution" : "install";
  return {
    deviceId: "PE1",
    stages: VPN_CONTROL,
    activeStageId: failedAt,
    completedStageIds: completedBefore(VPN_CONTROL, failedAt),
    lookupType: "MP-BGP VPNv4 import + Service SID resolution (control plane — no packet)",
    lookupKey: `${route.prefix} · Service SID ${route.prefixSid?.l3Service.serviceSid.sidText ?? "—"}`,
    lookupResult: `RT import ${progress.rtImport?.passed ? "✓" : "✕"} · BGP next hop ${progress.bgpNextHop?.resolvable ? "✓" : "✕"} · Service SID ${progress.serviceSidResolution?.resolvable ? "✓" : "✕"} → ${progress.installed ? "INSTALLED" : "NOT INSTALLED"}`,
    reason: `SRv6: ${progress.serviceSidResolution?.reason ?? progress.rtImport?.reason ?? ""}`,
  };
}

/** The ONE shared TI-LFA computation at the PLR — architecture-independent by construction (the scenario computes it once for both encodings). */
function sharedRepairTrace(state: CapstoneState, stepId: string): DeviceProcessingTrace | undefined {
  const r = state.sharedRepair;
  if (!r) return undefined;
  const detecting = stepId === "link-fails";
  return {
    deviceId: "P1",
    stages: TILFA_CONTROL,
    activeStageId: detecting ? "failure-detect" : "repair-select",
    completedStageIds: detecting ? ["post-convergence", "pq-space", "repair-select"] : ["post-convergence", "pq-space"],
    lookupType: detecting ? "Local failure detection (shared)" : "TI-LFA precomputation (shared by both architectures)",
    lookupKey: `Protected ${PROTECTED_LINK} · destination ${r.destination}`,
    lookupResult: detecting
      ? `${PROTECTED_LINK} ${state.linkFailed ? "DOWN — detected locally at P1" : "up"} · precomputed OIF P1→${r.outgoingInterface ?? "?"}`
      : `P-Space {${r.pSpace.join(", ")}} · Q-Space {${r.qSpace.join(", ")}} → repair node ${r.repairNode ?? "none"}, merge ${r.mergeTarget ?? "none"}, OIF P1→${r.outgoingInterface ?? "?"}`,
    nextHopId: detecting && isCore(r.outgoingInterface) ? r.outgoingInterface : undefined,
    nextHopLabel: detecting ? r.outgoingInterface : undefined,
    egressInterfaceId: detecting ? ifaceId("P1", r.outgoingInterface) : undefined,
    reason: detecting
      ? "P1 detects its own link failure without waiting for IGP flooding; the repair topology was already computed — only its ENCODING differs per architecture (next steps)."
      : `Post-convergence path ${r.postConvergencePath?.join(" → ") ?? "—"} — computed once; SR-MPLS and SRv6 only differ in how this repair is encoded.`,
  };
}

/**
 * Step-aware, architecture-scoped trace. Precedence: a data-plane hop
 * recorded BY this step for this architecture at this router → a
 * control-plane event this step computed at this router → idle.
 */
export function traceFor(router: RouterId, state: CapstoneState, architecture: Architecture, stepId: string): DeviceProcessingTrace | undefined {
  if (!isCore(router)) return undefined; // customer sites run neither SR-MPLS nor SRv6
  const hop = state.journey.find((h) => h.stepId === stepId && h.architecture === architecture && h.router === router);
  if (hop) return hopTrace(hop);
  if (router === "PE1") {
    if ((stepId === "mpls-vpn-build" && architecture === "SR_MPLS") || ((stepId === "srv6-vpn-build" || stepId === "incident-fault-injected" || stepId === "incident-repair") && architecture === "SRV6")) {
      return vpnImportTrace(state, architecture) ?? idleTrace(router, architecture);
    }
  }
  if (router === "P1" && (stepId === "shared-tilfa-compute" || stepId === "link-fails")) return sharedRepairTrace(state, stepId) ?? idleTrace(router, architecture);
  return idleTrace(router, architecture);
}

/** Frames floating over the device interior: the packet as this device leaves it (or as it arrived, for a terminal hop). */
export function packetFramesFor(trace: DeviceProcessingTrace | undefined): PacketStackFrame[] | undefined {
  return trace?.packetAfterFrames ?? trace?.packetBeforeFrames;
}

// ---------------------------------------------------------------------------
// HopTimeline support
// ---------------------------------------------------------------------------

/** Device for the no-packet steps that still record something inspectable at one router (a control-plane import, the shared TI-LFA computation, an endpoint/repair execution). */
export const PRIMARY_TRANSITION_ROUTER: Partial<Record<string, RouterId>> = {
  "srv6-transport-endpoint": "PE2",
  "mpls-vpn-build": "PE1",
  "srv6-vpn-build": "PE1",
  "shared-tilfa-compute": "P1",
  "link-fails": "P1",
  "repair-execution": "P4",
  "incident-fault-injected": "PE1",
  "incident-repair": "PE1",
};

/** Sender priority (`packet.from ?? packet.to`) — every JourneyHop is recorded against the router that PERFORMED the label/encapsulation operation (MPLS L3VPN / SRv6 L3VPN convention). */
export function deviceForStep(stepId: string, packet: PacketVisual | undefined): RouterId | undefined {
  if (packet) return (packet.from ?? packet.to) as RouterId;
  return PRIMARY_TRANSITION_ROUTER[stepId];
}

// ---------------------------------------------------------------------------
// Interfaces / link detail
// ---------------------------------------------------------------------------

function linkIsDown(state: CapstoneState, a: RouterId, b: RouterId): boolean {
  return state.linkFailed && ((a === "P1" && b === "P2") || (a === "P2" && b === "P1"));
}

export function interfacesFor(router: RouterId, state: CapstoneState, architecture: Architecture, stepId: string): DeviceInterfaceData[] {
  const trace = traceFor(router, state, architecture, stepId);
  const processing = trace?.activeStageId !== undefined;
  return INTERFACES[router].map((def) => {
    // An Adj-SID is genuinely per-adjacency (one per core interface); SRv6 in this model binds End.X per ROUTER, not per interface, so nothing per-interface is claimed for it.
    const extra = architecture === "SR_MPLS" && isCore(router) && isCore(def.neighborId) ? [{ label: `Adj-SID (${router}→${def.neighborId})`, value: `${adjSidLabel(router, def.neighborId)} (local)` }] : [];
    return {
      id: def.id,
      name: def.name,
      status: linkIsDown(state, router, def.neighborId) ? "down" : "up",
      ip: infraIp(router),
      neighborId: def.neighborId,
      neighborLabel: def.neighborLabel,
      linkType: def.linkType,
      mtu: def.mtu,
      protocols: !isCore(def.neighborId) || !isCore(router) ? ["IPv4 (customer)"] : architecture === "SR_MPLS" ? ["IGP", "SR-MPLS"] : ["IGP", "IPv6", "SRv6"],
      packetCount: processing && (def.id === trace?.ingressInterfaceId || def.id === trace?.egressInterfaceId) ? 1 : 0,
      role: processing && def.id === trace?.ingressInterfaceId ? "ingress" : processing && def.id === trace?.egressInterfaceId ? "egress" : "idle",
      extra,
    };
  });
}

/** Physical cable detail only — never a logical SID/label/policy relation. `currentPacket` is shown only if the current step's packet is physically crossing THIS link. */
export function linkDetailFor(linkId: string, state: CapstoneState, architecture: Architecture, currentPacket?: PacketVisual): LinkDetail | undefined {
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!edge) return undefined;
  const a = edge.a;
  const b = edge.b;
  const aIface = INTERFACES[a].find((f) => f.neighborId === b);
  const bIface = INTERFACES[b].find((f) => f.neighborId === a);
  if (!aIface || !bIface) return undefined;
  const down = linkIsDown(state, a, b);
  const core = isCore(a) && isCore(b);
  const protos = !core ? ["IPv4 (customer)"] : architecture === "SR_MPLS" ? ["IGP", "SR-MPLS"] : ["IGP", "IPv6", "SRv6"];
  const onThisLink = currentPacket && ((currentPacket.from === a && currentPacket.to === b) || (currentPacket.from === b && currentPacket.to === a));
  return {
    aLabel: a,
    bLabel: b,
    aInterface: { id: aIface.id, name: aIface.name, status: down ? "down" : "up", ip: infraIp(a), neighborId: b, neighborLabel: b, linkType: aIface.linkType, mtu: aIface.mtu, protocols: protos, role: "idle" },
    bInterface: { id: bIface.id, name: bIface.name, status: down ? "down" : "up", ip: infraIp(b), neighborId: a, neighborLabel: a, linkType: bIface.linkType, mtu: bIface.mtu, protocols: protos, role: "idle" },
    status: down ? "down" : "up",
    mtu: aIface.mtu,
    protocols: [
      { label: "IGP", value: core ? "shared, architecture-independent" : "none (customer access)" },
      ...(core && architecture === "SR_MPLS" && isCore(a) && isCore(b) ? [{ label: "Adj-SIDs (local)", value: `${a}→${b}=${adjSidLabel(a, b)} · ${b}→${a}=${adjSidLabel(b, a)}` }] : []),
      { label: "Protected resource", value: linkId === PROTECTED_LINK ? "Yes — TI-LFA protected link" : "No" },
    ],
    currentTraffic: onThisLink ? `${currentPacket.protocol === "MPLS" ? "SR-MPLS" : "SRv6"} packet this step: ${currentPacket.summary}` : undefined,
  };
}

export const DEVICE_ROUTERS = CORE_ROUTERS_FOR_IFACE;
