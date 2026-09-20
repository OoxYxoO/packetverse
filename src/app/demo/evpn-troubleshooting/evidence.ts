import {
  EXTERNAL_PREFIX,
  HOST_A_IP,
  HOST_A_MAC,
  HOST_B_IP,
  HOST_B_MAC,
  L3_VNI,
  ROAMER_IP,
  ROAMER_MAC,
  SERVER_A_IP,
  SERVER_A_MAC,
  VLAN10,
  VLAN20,
  VNI10010,
  VNI10020,
  VTEP_LOOPBACK,
  type ArenaLeafId,
  type ArenaState,
} from "@/lib/sim-engine/arena/faultTypes";

/**
 * Evidence layer (brief §33's `evidence.ts`) — the ONLY place that
 * turns ArenaState into rendered text for tests, CLI output, and
 * packet traces/captures. Every function here is a pure read of
 * ArenaState; nothing here decides whether the network works, and
 * nothing here ever mentions a fault id, category, or root cause.
 * Because tests, CLI, and packet trace all call the SAME predicate
 * helpers below, they can never disagree with each other or with the
 * topology/GUI (brief §35).
 */

export type TestId =
  | "ping"
  | "arp"
  | "mac-lookup"
  | "evpn-route"
  | "vrf-route"
  | "vtep-reachability"
  | "packet-trace"
  | "interface-state"
  | "bgp-neighbor"
  | "vni-state"
  | "ethernet-segment"
  | "df-state"
  | "vpws-service";

export interface TestResult {
  title: string;
  lines: string[];
  success?: boolean;
  /** Structured, frozen-at-run-time hop data — populated only for packet-trace results (brief §17/§18: Follow Packet / FloodCopy3D need the same facts the text lines already carry, not a re-derivation from live state). */
  hops?: TraceHop[];
}

type NamedHost = "HOST-A" | "HOST-B" | "SERVER-A" | "ROAMER";
function hostInfo(name: string): { ip: string; mac: string; leaf: ArenaLeafId; vni: number } | undefined {
  switch (name as NamedHost) {
    case "HOST-A":
      return { ip: HOST_A_IP, mac: HOST_A_MAC, leaf: "LEAF1", vni: VNI10010 };
    case "HOST-B":
      return { ip: HOST_B_IP, mac: HOST_B_MAC, leaf: "LEAF3", vni: VNI10010 };
    case "SERVER-A":
      return { ip: SERVER_A_IP, mac: SERVER_A_MAC, leaf: "LEAF1", vni: VNI10010 };
    case "ROAMER":
      return { ip: ROAMER_IP, mac: ROAMER_MAC, leaf: "LEAF2", vni: VNI10010 };
    default:
      return undefined;
  }
}
function isLeaf(name: string): name is ArenaLeafId {
  return name === "LEAF1" || name === "LEAF2" || name === "LEAF3";
}

// ---------------------------------------------------------------------------
// Shared predicates — every test AND the CLI AND the packet trace read
// these, never a separate/duplicated notion of "is this healthy."
// ---------------------------------------------------------------------------

export function type2Route(state: ArenaState, mac: string) {
  return state.type2Routes.find((r) => r.mac === mac);
}
export function type2Installed(state: ArenaState, mac: string): boolean {
  const r = type2Route(state, mac);
  return !!r && r.rtMatchesLocally;
}
export function underlayOk(state: ArenaState, a: ArenaLeafId, b: ArenaLeafId): boolean {
  if (a === b) return true;
  return !!state.vtepReachable[a]?.[b];
}
export function imetOk(state: ArenaState, leaf: ArenaLeafId, vni: number): boolean {
  return !!state.imetMembership[leaf]?.[vni];
}
export function l3VniOk(state: ArenaState, source: ArenaLeafId, target: ArenaLeafId): boolean {
  return state.l3VniByLeaf[source] === state.l3VniByLeaf[target];
}
export function dfConsistent(state: ArenaState): boolean {
  const believers = state.es.leafs.filter((l) => state.es.dualDfBelief[l]);
  return believers.length === 1;
}
export function aliasingUsable(state: ArenaState, chosenPe: ArenaLeafId): boolean {
  if (!state.aliasing.eligiblePEs.includes(chosenPe)) return false;
  if (state.es.esAttachmentDown === chosenPe) return false;
  return true;
}
export function mobilityCurrent(state: ArenaState): boolean {
  return state.roamer.remoteBelievedLeaf === state.roamer.actualLeaf;
}
export function suppressionPresent(state: ArenaState, leaf: ArenaLeafId): boolean {
  return !!state.suppression.bindingPresentAt[leaf];
}
export function vpwsPrimaryUsable(state: ArenaState): boolean {
  return !!state.vpws.primaryPe && state.vpws.acDown !== state.vpws.primaryPe;
}

// ---------------------------------------------------------------------------
// Toolbox tests (brief §12) — real reads of ArenaState, never scripted.
// ---------------------------------------------------------------------------

function pingKnownUnicast(state: ArenaState, from: ReturnType<typeof hostInfo>, to: ReturnType<typeof hostInfo>): TestResult {
  if (!from || !to) return { title: "Ping", lines: ["Unknown endpoint."], success: false };
  const lines: string[] = [];
  const route = type2Route(state, to.mac);
  lines.push(route ? `Remote route for ${to.ip}: present (origin ${route.originLeaf})` : `Remote route for ${to.ip}: NOT FOUND`);
  if (!route) return { title: "Ping", lines, success: false };
  lines.push(`Route imported locally: ${route.rtMatchesLocally ? "yes" : "NO"}`);
  if (!route.rtMatchesLocally) return { title: "Ping", lines, success: false };

  // SERVER-A is multihomed — resolve via the aliasing/eligible-set model instead of a single static leaf.
  let targetLeaf = to.leaf;
  if (to.mac === SERVER_A_MAC) {
    const sorted = [...state.aliasing.eligiblePEs].sort();
    const chosen = sorted[0] ?? "LEAF1";
    lines.push(`Aliasing eligible next-hops for ${to.ip}: {${state.aliasing.eligiblePEs.join(", ") || "none"}} — flow selects ${chosen}`);
    if (!aliasingUsable(state, chosen)) {
      lines.push(`${chosen}'s ES attachment is actually DOWN — this flow does not arrive.`);
      return { title: "Ping", lines, success: false };
    }
    targetLeaf = chosen;
  }
  const underlay = underlayOk(state, from.leaf, targetLeaf);
  lines.push(`Underlay reachability ${from.leaf} → ${targetLeaf}: ${underlay ? "OK" : "FAILED"}`);
  if (!underlay) return { title: "Ping", lines, success: false };
  lines.push(`${to.ip} responds.`);
  return { title: "Ping", lines, success: true };
}

export function runPing(state: ArenaState, from: string, to: string): TestResult {
  const fromInfo = hostInfo(from);
  if (to === EXTERNAL_PREFIX) {
    const lines = [`Type-5 route for ${EXTERNAL_PREFIX}: present (origin ${state.type5.originLeaf})`, `Next-hop VTEP ${state.type5.nextHopVtep}: ${state.type5.nextHopReachable ? "reachable" : "UNRESOLVED"}`];
    return { title: "Ping", lines, success: state.type5.nextHopReachable };
  }
  if (/^10\.10\.20\./.test(to)) {
    if (!fromInfo) return { title: "Ping", lines: ["Unknown source host."], success: false };
    const targetLeaf: ArenaLeafId = "LEAF3";
    const ok = l3VniOk(state, fromInfo.leaf, targetLeaf);
    const lines = [
      `${to} is on VLAN ${VLAN20} — a different subnet from ${from} (VLAN ${VLAN10}).`,
      `TENANT-A L3 VNI — ${fromInfo.leaf}: ${state.l3VniByLeaf[fromInfo.leaf]}, ${targetLeaf}: ${state.l3VniByLeaf[targetLeaf]}`,
      ok ? "Inter-subnet route resolves correctly." : "L3 VNI mismatch — inter-subnet traffic cannot be routed.",
    ];
    return { title: "Ping", lines, success: ok };
  }
  const toInfo = to === "ROAMER" ? hostInfo("ROAMER") : hostInfo(to);
  return pingKnownUnicast(state, fromInfo, toInfo);
}

export function runArpTest(state: ArenaState, leaf: string, targetIp: string): TestResult {
  if (!isLeaf(leaf)) return { title: "ARP / Neighbor Test", lines: ["Unknown device."], success: false };
  const bound = suppressionPresent(state, leaf);
  const lines = [
    `${leaf} local MAC/IP binding for ${targetIp}: ${bound ? "present" : "ABSENT"}`,
    bound ? `${leaf} answers the ARP request locally (suppressed)` : `${leaf} has no local binding — request is flooded fabric-wide instead of being suppressed.`,
  ];
  return { title: "ARP / Neighbor Test", lines, success: bound };
}

export function runMacLookup(state: ArenaState, leaf: string, mac: string): TestResult {
  if (!isLeaf(leaf)) return { title: "MAC Lookup", lines: ["Unknown device."], success: false };
  const route = type2Route(state, mac);
  if (!route) return { title: "MAC Lookup", lines: [`${mac}: no route known.`], success: false };
  const lines = [`${mac} → origin ${route.originLeaf}, VNI ${route.vni}${route.esi ? `, ESI ${route.esi.slice(-8)}` : ""}`, `Imported at ${leaf}: ${route.rtMatchesLocally ? "yes" : "NO"}`];
  return { title: "MAC Lookup", lines, success: route.rtMatchesLocally };
}

export function runEvpnRouteLookup(state: ArenaState, routeType: string): TestResult {
  const lines: string[] = [];
  if (routeType === "2") {
    state.type2Routes.forEach((r) => lines.push(`Type 2 — ${r.mac} / ${r.ip} — origin ${r.originLeaf} — RT ${r.rtMatchesLocally ? "matched" : "NOT MATCHED"}`));
  } else if (routeType === "3") {
    (["LEAF1", "LEAF2", "LEAF3"] as ArenaLeafId[]).forEach((l) => lines.push(`Type 3 (IMET) — ${l} — VNI ${VNI10010}: ${imetOk(state, l, VNI10010) ? "member" : "NOT a member"}, VNI ${VNI10020}: ${imetOk(state, l, VNI10020) ? "member" : "not a member"}`));
  } else if (routeType === "5") {
    lines.push(`Type 5 — ${state.type5.prefix} — origin ${state.type5.originLeaf} — next hop ${state.type5.nextHopVtep} (${state.type5.nextHopReachable ? "resolved" : "UNRESOLVED"})`);
  } else if (routeType === "1") {
    lines.push(`Type 1 — A-D per-ES — ESI ${state.es.esi.slice(-8)} — leaves: ${state.es.leafs.join(", ")}`);
    lines.push(`Type 1 — A-D per-EVI — VPWS-${state.vpws.serviceId} — Primary ${state.vpws.primaryPe ?? "none"}, Backup ${state.vpws.backupPe ?? "none"}`);
  } else if (routeType === "4") {
    lines.push(`Type 4 — Ethernet Segment Route — ESI ${state.es.esi.slice(-8)} — advertised by: ${state.es.leafs.join(", ")}`);
  } else {
    lines.push("Unknown route type. Use 1, 2, 3, 4, or 5.");
  }
  return { title: `EVPN Route Lookup — Type ${routeType}`, lines };
}

export function runVrfRouteLookup(state: ArenaState, leaf: string): TestResult {
  if (!isLeaf(leaf)) return { title: "VRF Route Lookup", lines: ["Unknown device."], success: false };
  const lines = [`VRF TENANT-A — L3 VNI at ${leaf}: ${state.l3VniByLeaf[leaf]} (expected ${L3_VNI})`, `10.10.20.0/24 (bridged, VNI ${VNI10020}): local`, `${state.type5.prefix} (Type-5, routed): next hop ${state.type5.nextHopVtep} — ${state.type5.nextHopReachable ? "installed" : "NOT installed"}`];
  return { title: "VRF Route Lookup", lines, success: state.l3VniByLeaf[leaf] === L3_VNI };
}

export function runVtepReachability(state: ArenaState, from: string, to: string): TestResult {
  if (to === "SERVER-A") {
    if (!isLeaf(from)) return { title: "VTEP / Next-Hop Reachability", lines: ["Unknown device."], success: false };
    const sorted = [...state.aliasing.eligiblePEs].sort();
    const chosen = sorted[0] ?? "LEAF1";
    const lines = [
      `Eligible next-hop PEs for SERVER-A's MAC at ${from}: {${state.aliasing.eligiblePEs.join(", ") || "none"}}`,
      `Deterministic flow selection → ${chosen}`,
      `${chosen} ES attachment: ${state.es.esAttachmentDown === chosen ? "DOWN" : "up"}`,
    ];
    return { title: "VTEP / Next-Hop Reachability", lines, success: aliasingUsable(state, chosen) };
  }
  if (!isLeaf(from) || !isLeaf(to)) return { title: "VTEP / Next-Hop Reachability", lines: ["Unknown device."], success: false };
  const ok = underlayOk(state, from, to);
  return { title: "VTEP / Next-Hop Reachability", lines: [`${from} (${VTEP_LOOPBACK[from]}) → ${to} (${VTEP_LOOPBACK[to]}): ${ok ? "reachable" : "UNREACHABLE"}`], success: ok };
}

export function runInterfaceState(state: ArenaState, device: string): TestResult {
  if (!isLeaf(device)) return { title: "Interface State", lines: [`${device}: no additional interface state modeled.`] };
  const lines = [`Uplink to SPINE1: up`, `Access/AC interfaces: ${state.vpws.acDown === device ? "one AC DOWN (VPWS-500)" : "up"}${device === "LEAF1" && state.es.esAttachmentDown === "LEAF1" ? ", ES attachment to SERVER-A DOWN" : ""}`];
  return { title: "Interface State", lines };
}

export function runBgpNeighbor(state: ArenaState, leaf: string): TestResult {
  if (!isLeaf(leaf)) return { title: "BGP Neighbor", lines: ["Unknown device."], success: false };
  const up = state.bgpEvpnUp[leaf];
  return { title: "BGP Neighbor", lines: [`${leaf} BGP EVPN session: ${up ? "Established" : "NOT Established"}`], success: up };
}

export function runVniState(state: ArenaState, leaf: string, vni: string): TestResult {
  if (!isLeaf(leaf)) return { title: "VNI State", lines: ["Unknown device."], success: false };
  const vniNum = Number(vni);
  const ok = imetOk(state, leaf, vniNum);
  return { title: "VNI State", lines: [`${leaf} — VNI ${vniNum}: ${ok ? "member (IMET present)" : "NOT a member"}`], success: ok };
}

export function runEthernetSegment(state: ArenaState, leaf: string): TestResult {
  const leaves = leaf.split(",").filter(isLeaf) as ArenaLeafId[];
  const targets = leaves.length ? leaves : state.es.leafs;
  const lines = targets.map((l) => `${l} — ESI ${state.es.esi.slice(-8)} — believes DF: ${state.es.dualDfBelief[l] ? "yes" : "no"}${state.es.esAttachmentDown === l ? " — attachment DOWN" : ""}`);
  return { title: "Ethernet Segment", lines, success: dfConsistent(state) };
}

export function runDfState(state: ArenaState): TestResult {
  const believers = state.es.leafs.filter((l) => state.es.dualDfBelief[l]);
  const lines = [`Leaves believing they are DF: ${believers.join(", ") || "none"}`, dfConsistent(state) ? "Exactly one DF — consistent." : "More than one leaf believes it is DF — inconsistent."];
  return { title: "DF State", lines, success: dfConsistent(state) };
}

export function runVpwsService(state: ArenaState): TestResult {
  const lines = [
    `VPWS-${state.vpws.serviceId} — Primary: ${state.vpws.primaryPe ?? "none"}, Backup: ${state.vpws.backupPe ?? "none"}`,
    `Primary attachment circuit: ${vpwsPrimaryUsable(state) ? "up" : "DOWN"}`,
    `L2 MTU — Primary advertises: ${state.vpws.primaryPe ? state.vpws.l2MtuAdvertised[state.vpws.primaryPe] : "—"}, remote expects: ${state.vpws.remoteExpectedMtu}`,
    `Service status: ${state.vpws.status.toUpperCase()}`,
  ];
  return { title: "VPWS Service", lines, success: state.vpws.status === "up" && vpwsPrimaryUsable(state) };
}

export function runTest(state: ArenaState, testId: TestId, params: Record<string, string>): TestResult {
  switch (testId) {
    case "ping":
      return runPing(state, params.from, params.to);
    case "arp":
      return runArpTest(state, params.from ?? params.leaf, params.to ?? state.suppression.targetIp);
    case "mac-lookup":
      return runMacLookup(state, params.leaf, params.mac);
    case "evpn-route":
      return runEvpnRouteLookup(state, params.type);
    case "vrf-route":
      return runVrfRouteLookup(state, params.leaf);
    case "vtep-reachability":
      return runVtepReachability(state, params.from, params.to);
    case "packet-trace":
      return runPacketTrace(state, params.from, params.to);
    case "interface-state":
      return runInterfaceState(state, params.device ?? params.leaf);
    case "bgp-neighbor":
      return runBgpNeighbor(state, params.leaf);
    case "vni-state":
      return runVniState(state, params.leaf, params.vni);
    case "ethernet-segment":
      return runEthernetSegment(state, params.leaf ?? "");
    case "df-state":
      return runDfState(state);
    case "vpws-service":
      return runVpwsService(state);
    default:
      return { title: "Test", lines: ["Unknown test."] };
  }
}

// ---------------------------------------------------------------------------
// Packet Trace (brief §16) — hop-by-hop, stops at the exact point of
// failure, never auto-labels the cause.
// ---------------------------------------------------------------------------

/** Which conceptual pipeline stage (see deviceTrace.ts's PIPELINE_STAGES) a hop belongs to at its device — purely a presentation grouping, never a new domain fact. */
export type HopStage = "ingress" | "fwd-decision" | "encap-decap" | "replicate" | "egress";

export interface TraceHop {
  label: string;
  ok: boolean;
  /** The device this hop's activity happened at — undefined for an end-host marker (no Device Explorer surface to enter). */
  deviceId?: ArenaLeafId | "SPINE1";
  stage?: HopStage;
  lookupType?: string;
  lookupKey?: string;
  lookupResult?: string;
  /** Why the lookup/check came out this way — only set for a hop the learner could plausibly want explained (the same fact the label's ✓/✕ already displays as text). */
  reason?: string;
}

export function runPacketTrace(state: ArenaState, from: string, to: string): TestResult {
  const hops: TraceHop[] = [];
  const fromInfo = hostInfo(from);
  if (to === "broadcast") {
    hops.push({ label: `${from} ✓`, ok: true });
    if (!fromInfo) return traceResult(hops);
    hops.push({ label: `${fromInfo.leaf} ingress ✓`, ok: true, deviceId: fromInfo.leaf, stage: "ingress" });
    hops.push({ label: "SPINE1 replication ✓", ok: true, deviceId: "SPINE1", stage: "replicate", lookupType: "Flood List (VNI IMET Membership)", lookupResult: "replicating to all IMET members" });
    (["LEAF1", "LEAF2", "LEAF3"] as ArenaLeafId[]).forEach((l) => {
      if (l === fromInfo.leaf) return;
      const ok = imetOk(state, l, fromInfo.vni);
      hops.push({
        label: `${l} flood-list delivery ${ok ? "✓" : "✕"}`,
        ok,
        deviceId: l,
        stage: "egress",
        lookupType: `IMET (Type-3) Membership, VNI ${fromInfo.vni}`,
        lookupKey: l,
        lookupResult: ok ? "member" : "NOT a member",
        reason: ok ? undefined : `${l} is not in VNI ${fromInfo.vni}'s flood list, so replicated BUM traffic is never delivered here.`,
      });
    });
    return traceResult(hops);
  }
  const toInfo = to === "ROAMER" ? hostInfo("ROAMER") : hostInfo(to);
  if (!fromInfo || !toInfo) return traceResult([{ label: "Unknown endpoint ✕", ok: false }]);

  hops.push({ label: `${from} ✓`, ok: true });
  hops.push({ label: `${fromInfo.leaf} ingress ✓`, ok: true, deviceId: fromInfo.leaf, stage: "ingress" });

  if (to === "ROAMER" || toInfo.mac === ROAMER_MAC) {
    const believed = state.roamer.remoteBelievedLeaf;
    const current = believed === state.roamer.actualLeaf;
    hops.push({
      label: `${fromInfo.leaf} remote location lookup → ${believed} ${current ? "✓" : "(stale)"}`,
      ok: current,
      deviceId: fromInfo.leaf,
      stage: "fwd-decision",
      lookupType: "EVPN Type-2 Route (MAC Mobility)",
      lookupKey: toInfo.mac,
      lookupResult: `believed location: ${believed}`,
      reason: current ? undefined : `${fromInfo.leaf} never accepted a newer mobility sequence for this host — it still forwards toward ${believed}.`,
    });
    if (!current) {
      hops.push({ label: `VXLAN toward ${believed} ✓ (wrong destination)`, ok: true, deviceId: "SPINE1", stage: "replicate" });
      hops.push({ label: `${believed} decap — host not actually present here ✕`, ok: false, deviceId: believed, stage: "encap-decap", lookupType: "Local MAC Table", lookupKey: toInfo.mac, lookupResult: "not present at this leaf", reason: "The host physically moved away from this leaf." });
      return traceResult(hops);
    }
    hops.push({ label: "VXLAN encapsulation ✓", ok: true, deviceId: fromInfo.leaf, stage: "encap-decap" });
    hops.push({ label: "SPINE1 ✓", ok: true, deviceId: "SPINE1", stage: "replicate" });
    hops.push({ label: `${believed} VXLAN decap ✓`, ok: true, deviceId: believed, stage: "encap-decap" });
    return traceResult(hops);
  }

  const route = type2Route(state, toInfo.mac);
  hops.push({
    label: `Remote route lookup (${toInfo.ip}) ${route ? "✓" : "✕"}`,
    ok: !!route,
    deviceId: fromInfo.leaf,
    stage: "fwd-decision",
    lookupType: "EVPN RIB (Type-2 MAC/IP)",
    lookupKey: toInfo.mac,
    lookupResult: route ? `found, origin ${route.originLeaf}` : "no route",
  });
  if (!route) return traceResult(hops);
  hops.push({
    label: `Route import (RT) ${route.rtMatchesLocally ? "✓" : "✕"}`,
    ok: route.rtMatchesLocally,
    deviceId: fromInfo.leaf,
    stage: "fwd-decision",
    lookupType: "RT Import Policy",
    lookupKey: route.rt,
    lookupResult: route.rtMatchesLocally ? "matched, imported" : "NOT matched",
    reason: route.rtMatchesLocally ? undefined : `The Route Target carried by ${toInfo.ip}'s Type-2 route doesn't match this VNI's import policy.`,
  });
  if (!route.rtMatchesLocally) return traceResult(hops);

  let targetLeaf = toInfo.leaf;
  if (toInfo.mac === SERVER_A_MAC) {
    const sorted = [...state.aliasing.eligiblePEs].sort();
    targetLeaf = sorted[0] ?? "LEAF1";
    const usable = aliasingUsable(state, targetLeaf);
    hops.push({
      label: `Aliasing next-hop selection → ${targetLeaf} ${usable ? "✓" : "✕"}`,
      ok: usable,
      deviceId: fromInfo.leaf,
      stage: "fwd-decision",
      lookupType: "Aliasing Eligible Next-Hop Set",
      lookupKey: "SERVER-A",
      lookupResult: `selected ${targetLeaf}`,
      reason: usable ? undefined : `${targetLeaf} is no longer a usable next hop for this ES, but the eligible set hasn't been recomputed.`,
    });
    if (!usable) return traceResult(hops);
  }

  hops.push({ label: "VXLAN encapsulation ✓", ok: true, deviceId: fromInfo.leaf, stage: "encap-decap" });
  hops.push({ label: "SPINE1 ✓", ok: true, deviceId: "SPINE1", stage: "replicate" });
  const underlay = underlayOk(state, fromInfo.leaf, targetLeaf);
  hops.push({
    label: `${targetLeaf} VXLAN decap ${underlay ? "✓" : "✕ (underlay unreachable)"}`,
    ok: underlay,
    deviceId: targetLeaf,
    stage: "encap-decap",
    lookupType: "Underlay Reachability + VXLAN Decap",
    lookupKey: `${fromInfo.leaf} → ${targetLeaf}`,
    lookupResult: underlay ? "reachable, decapsulated" : "UNREACHABLE",
    reason: underlay ? undefined : `${fromInfo.leaf} and ${targetLeaf}'s VTEP loopbacks have no underlay path to each other.`,
  });
  if (!underlay) return traceResult(hops);
  hops.push({ label: `Delivered to ${to} ✓`, ok: true, deviceId: targetLeaf, stage: "egress" });
  return traceResult(hops);
}

function traceResult(hops: TraceHop[]): TestResult {
  return { title: "Packet Trace", lines: hops.map((h) => h.label), success: hops.every((h) => h.ok), hops };
}

// ---------------------------------------------------------------------------
// Packet Capture (brief §15)
// ---------------------------------------------------------------------------

export function runCapture(state: ArenaState, device: string, direction: "ingress" | "egress"): string[] {
  if (!isLeaf(device)) return ["No matching traffic observed."];
  const relevantHop = state.roamer.actualLeaf === device || state.type5.originLeaf === device || device === "LEAF1" || device === "LEAF3";
  if (!relevantHop) return ["No matching traffic observed."];
  const peer: ArenaLeafId = device === "LEAF3" ? "LEAF1" : "LEAF3";
  if (!underlayOk(state, device, peer)) return ["No matching traffic observed — underlay path to the relevant remote VTEP is currently down."];
  return [
    `${device} ${direction === "ingress" ? "uplink (ingress)" : "uplink (egress)"}`,
    "VXLAN",
    `SRC VTEP ${VTEP_LOOPBACK[device]}`,
    `DST VTEP ${VTEP_LOOPBACK[peer]}`,
    `VNI ${VNI10010}`,
  ];
}

// ---------------------------------------------------------------------------
// CLI (brief §13) — read-only, same predicates as everything above.
// ---------------------------------------------------------------------------

export function runCliCommand(state: ArenaState, device: string, flavor: "cisco" | "juniper", raw: string): string[] {
  const cmd = raw.trim().toLowerCase();
  if (!isLeaf(device) && device !== "SPINE1") return ["% Invalid device context."];

  if (/^show bgp( l2vpn evpn)? summary$/.test(cmd) || /^show bgp l2vpn evpn neighbor$/.test(cmd)) {
    if (device === "SPINE1") return ["Spine1 does not participate in BGP EVPN — underlay IGP only."];
    const up = state.bgpEvpnUp[device as ArenaLeafId];
    return flavor === "cisco" ? [`Neighbor        V    AS  State`, `route-reflector 4 65000  ${up ? "Established" : "Idle"}`] : [`Peer: route-reflector  State: ${up ? "Established" : "Idle"}`];
  }
  const routeTypeMatch = cmd.match(/route-type[ =](\d)/) || cmd.match(/match-prefix (\d):/);
  if (/^show (bgp l2vpn evpn|route table bgp\.evpn\.0)/.test(cmd)) {
    const rt = routeTypeMatch ? routeTypeMatch[1] : undefined;
    const result = runEvpnRouteLookup(state, rt ?? "2");
    return result.lines;
  }
  if (/^show (mac address-table|ethernet-switching table)/.test(cmd)) {
    return state.type2Routes.map((r) => `${r.mac}  vni ${r.vni}  ${r.originLeaf}  ${r.rtMatchesLocally ? "installed" : "not installed"}`);
  }
  if (/^show arp/.test(cmd)) {
    if (!isLeaf(device)) return ["No ARP table on Spine1."];
    return [`${state.suppression.targetIp}  ${state.suppression.targetMac}  binding: ${suppressionPresent(state, device) ? "local" : "none — flooding required"}`];
  }
  if (/^show interfaces/.test(cmd)) {
    return runInterfaceState(state, device).lines;
  }
  if (/^show evpn ethernet-segment/.test(cmd)) {
    if (!isLeaf(device) || !state.es.leafs.includes(device)) return ["No Ethernet Segment configured on this device."];
    return runEthernetSegment(state, device).lines;
  }
  if (/^show (nve vni|interfaces vtep|vxlan)/.test(cmd)) {
    if (!isLeaf(device)) return ["No VTEP on Spine1 — underlay-only device."];
    return [`VNI ${VNI10010}: ${imetOk(state, device, VNI10010) ? "Up" : "Down (not a flood-list member)"}`, `VNI ${VNI10020}: ${imetOk(state, device, VNI10020) ? "Up" : "Down"}`];
  }
  if (/^show evpn vpws/.test(cmd)) {
    return runVpwsService(state).lines;
  }
  if (/^ping /.test(cmd)) {
    const target = raw.trim().split(/\s+/)[1] ?? "";
    return runPing(state, device, target).lines;
  }
  return ["% Unrecognized command. Try: show bgp summary | show bgp l2vpn evpn route-type <1-5> | show mac address-table | show arp | show interfaces | show evpn ethernet-segment | show nve vni | show evpn vpws | ping <target>"];
}

export const CLI_SUGGESTIONS_CISCO = [
  "show bgp l2vpn evpn summary",
  "show bgp l2vpn evpn route-type 2",
  "show bgp l2vpn evpn route-type 3",
  "show bgp l2vpn evpn route-type 5",
  "show mac address-table",
  "show arp",
  "show interfaces",
  "show evpn ethernet-segment",
  "show nve vni",
  "show evpn vpws",
];
export const CLI_SUGGESTIONS_JUNIPER = [
  "show bgp l2vpn evpn neighbor",
  "show route table bgp.evpn.0 match-prefix 2:",
  "show route table bgp.evpn.0 match-prefix 3:",
  "show route table bgp.evpn.0 match-prefix 5:",
  "show ethernet-switching table",
  "show arp",
  "show interfaces terse",
  "show evpn ethernet-segment",
  "show interfaces vtep",
  "show evpn vpws",
];

export { hostInfo, isLeaf };
